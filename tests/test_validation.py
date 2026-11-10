import copy
import json
from pathlib import Path
import unittest

from validate_annotation import validate_annotation

ROOT = Path(__file__).resolve().parents[1]


class ValidationTests(unittest.TestCase):
    def setUp(self):
        self.valid = json.loads((ROOT / "examples/plug_type_a.json").read_text())

    def test_example(self):
        self.assertEqual(validate_annotation(self.valid), [])

    def test_invalid_fixtures_have_field_errors(self):
        for path in (ROOT / "tests/fixtures/invalid").glob("*.json"):
            with self.subTest(path=path.name):
                errors = validate_annotation(json.loads(path.read_text()))
                self.assertTrue(errors)
                self.assertTrue(all(error.startswith("$.") for error in errors))

    def test_bad_values_do_not_crash(self):
        for value in [None, True, "wrong", [], {"grasps": [None]}]:
            self.assertTrue(validate_annotation(value))
        for value in [float("nan"), float("inf"), True, "1", None]:
            annotation = copy.deepcopy(self.valid)
            annotation["grasps"][0]["contact_region"]["normal_obj"][0] = value
            self.assertTrue(validate_annotation(annotation))

    def test_projection_threshold_and_no_mutation(self):
        original = copy.deepcopy(self.valid)
        self.valid["grasps"][0]["contact_region"]["tangent_ref_obj"] = [0.0001, 0, 1]
        self.assertTrue(any("projection" in error for error in validate_annotation(self.valid)))
        self.assertEqual(validate_annotation(original), [])


if __name__ == "__main__":
    unittest.main()
