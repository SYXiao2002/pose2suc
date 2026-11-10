#!/usr/bin/env python3
"""Transform object-space suction templates to base-frame poses; numpy + stdlib only."""

import argparse
import json
import math
from pathlib import Path
import sys

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from validate_annotation import load_annotation, validate_annotation  # noqa: E402


def rigid_transform(value, name):
    matrix = np.asarray(value, dtype=float)
    if matrix.shape != (4, 4) or not np.isfinite(matrix).all():
        raise ValueError(f"{name}: expected a finite 4x4 homogeneous matrix")
    if not np.allclose(matrix[3], [0, 0, 0, 1], atol=1e-8, rtol=0):
        raise ValueError(f"{name}: last row must be [0, 0, 0, 1]")
    rotation = matrix[:3, :3]
    if not np.allclose(rotation.T @ rotation, np.eye(3), atol=1e-6, rtol=0) or not math.isclose(np.linalg.det(rotation), 1, abs_tol=1e-6):
        raise ValueError(f"{name}: rotation must be orthonormal with determinant +1 (no scaling/reflection)")
    return matrix


def quaternion_xyzw(rotation):
    """Unit quaternion for a proper rotation; columns are tool axes in base frame."""
    r = np.asarray(rotation, dtype=float)
    trace = float(np.trace(r))
    if trace > 0:
        s = math.sqrt(trace + 1) * 2
        q = np.array([(r[2, 1] - r[1, 2]) / s, (r[0, 2] - r[2, 0]) / s,
                      (r[1, 0] - r[0, 1]) / s, s / 4])
    else:
        i = int(np.argmax(np.diag(r)))
        if i == 0:
            s = math.sqrt(1 + r[0, 0] - r[1, 1] - r[2, 2]) * 2
            q = np.array([s / 4, (r[0, 1] + r[1, 0]) / s, (r[0, 2] + r[2, 0]) / s, (r[2, 1] - r[1, 2]) / s])
        elif i == 1:
            s = math.sqrt(1 + r[1, 1] - r[0, 0] - r[2, 2]) * 2
            q = np.array([(r[0, 1] + r[1, 0]) / s, s / 4, (r[1, 2] + r[2, 1]) / s, (r[0, 2] - r[2, 0]) / s])
        else:
            s = math.sqrt(1 + r[2, 2] - r[0, 0] - r[1, 1]) * 2
            q = np.array([(r[0, 2] + r[2, 0]) / s, (r[1, 2] + r[2, 1]) / s, s / 4, (r[1, 0] - r[0, 1]) / s])
    q /= np.linalg.norm(q)
    if q[3] < 0:
        q = -q
    return q.tolist()


def transform_annotation(annotation, T_obj_cam=None, T_cam_base=None,
                         pre_offset_m=0.05, pose_source_confidence=None,
                         use_best_candidate=False):
    """Return priority-sorted, non-deprecated poses. Matrices act on column vectors."""
    errors = validate_annotation(annotation)
    if errors:
        raise ValueError("Invalid annotation:\n" + "\n".join(errors))
    if isinstance(pre_offset_m, bool) or not isinstance(pre_offset_m, (int, float)) or not math.isfinite(pre_offset_m) or pre_offset_m < 0:
        raise ValueError("pre_offset_m must be finite and >= 0")
    if pose_source_confidence is not None and (isinstance(pose_source_confidence, bool)
            or not isinstance(pose_source_confidence, (int, float))
            or not math.isfinite(pose_source_confidence) or not 0 <= pose_source_confidence <= 1):
        raise ValueError("pose_source_confidence must be null or a finite number in [0, 1]")
    obj_cam = rigid_transform(np.eye(4) if T_obj_cam is None else T_obj_cam, "T_obj_cam")
    cam_base = rigid_transform(np.eye(4) if T_cam_base is None else T_cam_base, "T_cam_base")
    transform = cam_base @ obj_cam
    rotation, translation = transform[:3, :3], transform[:3, 3]
    results = []
    for grasp in sorted(annotation["grasps"], key=lambda item: (item["priority"], item["grasp_id"])):
        if grasp["status"] == "deprecated":
            continue
        region = grasp["contact_region"]
        execution_point = region["center_obj"]
        source = "center_obj"
        if use_best_candidate and grasp.get("candidate_points"):
            index, candidate = max(enumerate(grasp["candidate_points"]), key=lambda pair: pair[1]["score"])
            execution_point = candidate["point_obj"]
            source = f"candidate_points[{index}]"
        center = rotation @ np.asarray(region["center_obj"], dtype=float) + translation
        position = rotation @ np.asarray(execution_point, dtype=float) + translation
        normal = rotation @ np.asarray(region["normal_obj"], dtype=float)
        normal /= np.linalg.norm(normal)
        tangent = rotation @ np.asarray(region["tangent_ref_obj"], dtype=float)
        tangent /= np.linalg.norm(tangent)
        z_axis = -normal
        x_axis = tangent - np.dot(tangent, z_axis) * z_axis
        length = np.linalg.norm(x_axis)
        if length <= 1e-3:
            raise ValueError(f"{grasp['grasp_id']}.tangent_ref_obj: degenerate tangent projection <= 0.001")
        x_axis /= length
        y_axis = np.cross(z_axis, x_axis)
        y_axis /= np.linalg.norm(y_axis)
        tool_rotation = np.column_stack((x_axis, y_axis, z_axis))
        pre_offset = normal * pre_offset_m
        results.append({
            "grasp_id": grasp["grasp_id"], "priority": grasp["priority"], "status": grasp["status"],
            "notes": grasp.get("notes", ""), "normal_source": region["normal_source"],
            "position": position.tolist(), "quaternion": quaternion_xyzw(tool_rotation),
            "quaternion_order": "xyzw", "approach_direction": z_axis.tolist(),
            "pre_offset": pre_offset.tolist(), "pre_offset_m": pre_offset_m,
            "pregrasp_position": (position + pre_offset).tolist(),
            "contact_center_base": center.tolist(), "normal_base": normal.tolist(),
            "tangent_ref_base": tangent.tolist(), "radius_m": region["radius_m"],
            "execution_point_source": source, "pose_source_confidence": pose_source_confidence,
        })
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("annotation", type=Path)
    parser.add_argument("--object-pose", type=Path, help="JSON 4x4 T_obj_cam; default identity")
    parser.add_argument("--extrinsics", type=Path, help="JSON 4x4 T_cam_base; default identity")
    parser.add_argument("--pre-offset-m", type=float, default=0.05)
    parser.add_argument("--pose-source-confidence", type=float)
    parser.add_argument("--use-best-candidate", action="store_true")
    parser.add_argument("--output", type=Path, help="Output JSON, default stdout")
    args = parser.parse_args()
    try:
        results = transform_annotation(
            load_annotation(args.annotation),
            load_annotation(args.object_pose) if args.object_pose else None,
            load_annotation(args.extrinsics) if args.extrinsics else None,
            args.pre_offset_m, args.pose_source_confidence, args.use_best_candidate,
        )
        text = json.dumps(results, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
        if args.output:
            args.output.write_text(text, encoding="utf-8")
        else:
            print(text, end="")
    except (OSError, ValueError, TypeError) as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
