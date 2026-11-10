import copy
import json
from pathlib import Path
import unittest

import numpy as np

from reference.transform_grasp import quaternion_xyzw, transform_annotation

ROOT = Path(__file__).resolve().parents[1]


def rotation_from_quaternion(q):
    x, y, z, w = q
    return np.array([
        [1 - 2*(y*y+z*z), 2*(x*y-z*w), 2*(x*z+y*w)],
        [2*(x*y+z*w), 1 - 2*(x*x+z*z), 2*(y*z-x*w)],
        [2*(x*z-y*w), 2*(y*z+x*w), 1 - 2*(x*x+y*y)],
    ])


class TransformTests(unittest.TestCase):
    def setUp(self):
        self.annotation = json.loads((ROOT / "examples/plug_type_a.json").read_text())

    def test_identity_and_tool_axes(self):
        grasp = self.annotation["grasps"][0]
        result = transform_annotation(self.annotation)[0]
        np.testing.assert_allclose(result["position"], grasp["contact_region"]["center_obj"])
        np.testing.assert_allclose(result["approach_direction"], [0, 0, -1])
        np.testing.assert_allclose(result["pre_offset"], [0, 0, 0.05])
        np.testing.assert_allclose(result["pregrasp_position"], [0.012, 0.003, 0.095])
        np.testing.assert_allclose(rotation_from_quaternion(result["quaternion"]), np.diag([1, -1, -1]), atol=1e-12)

    def test_two_nontrivial_rotations_match_hand_calculation(self):
        obj_cam = json.loads((ROOT / "examples/T_obj_cam.json").read_text())
        cam_base = json.loads((ROOT / "examples/T_cam_base.json").read_text())
        result = transform_annotation(self.annotation, obj_cam, cam_base, pose_source_confidence=0.92)[0]
        # p_cam = [0.097, 0.212, 0.345]; p_base = [0.497, 0.155, 0.812].
        np.testing.assert_allclose(result["position"], [0.497, 0.155, 0.812])
        np.testing.assert_allclose(result["normal_base"], [0, -1, 0])
        np.testing.assert_allclose(result["approach_direction"], [0, 1, 0])
        np.testing.assert_allclose(result["tangent_ref_base"], [0, 0, 1])
        np.testing.assert_allclose(result["pregrasp_position"], [0.497, 0.105, 0.812])
        np.testing.assert_allclose(rotation_from_quaternion(result["quaternion"]), [[0, 1, 0], [0, 0, 1], [1, 0, 0]], atol=1e-12)
        self.assertEqual(result["pose_source_confidence"], 0.92)

    def test_parallel_tangent_and_invalid_transforms_rejected(self):
        self.annotation["grasps"][0]["contact_region"]["tangent_ref_obj"] = [0, 0, 1]
        with self.assertRaisesRegex(ValueError, "tangent_ref_obj"):
            transform_annotation(self.annotation)
        self.setUp()
        for transform in [np.diag([2, 1, 1, 1]), np.diag([-1, 1, 1, 1]), np.zeros((3, 3)), np.full((4, 4), np.nan)]:
            with self.assertRaises(ValueError):
                transform_annotation(self.annotation, transform)
        with self.assertRaises(ValueError):
            transform_annotation(self.annotation, pre_offset_m=-1)

    def test_filter_sort_candidate_and_anchor_separation(self):
        original = self.annotation["grasps"][0]
        original["candidate_points"] = [{"point_obj": [1, 2, 3], "score": 0.3}, {"point_obj": [4, 5, 6], "score": 0.9}]
        first = copy.deepcopy(original); first.update(grasp_id="first", priority=1)
        original["priority"] = 2
        deprecated = copy.deepcopy(original); deprecated.update(grasp_id="old", status="deprecated")
        self.annotation["grasps"] += [first, deprecated]
        results = transform_annotation(self.annotation, use_best_candidate=True)
        self.assertEqual([r["grasp_id"] for r in results], ["first", "top_region_v1"])
        np.testing.assert_allclose(results[0]["position"], [4, 5, 6])
        np.testing.assert_allclose(results[0]["contact_center_base"], [0.012, 0.003, 0.045])
        self.assertEqual(results[0]["execution_point_source"], "candidate_points[1]")

    def test_quaternion_handles_half_turns_about_each_axis(self):
        for rotation in [np.eye(3), np.diag([1, -1, -1]), np.diag([-1, 1, -1]), np.diag([-1, -1, 1])]:
            quaternion = quaternion_xyzw(rotation)
            self.assertAlmostEqual(np.linalg.norm(quaternion), 1)
            np.testing.assert_allclose(rotation_from_quaternion(quaternion), rotation, atol=1e-12)


if __name__ == "__main__":
    unittest.main()
