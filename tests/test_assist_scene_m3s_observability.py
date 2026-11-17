"""Author-written geometry falsifications, NOT empirical visual-quality evidence."""
from pathlib import Path
import sys
import unittest
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import assist_scene_m3s_observability as m


class GeometryTests(unittest.TestCase):
    def square(self,center):
        return np.asarray(center)+np.asarray([[-.2,-.2,0],[-.2,.2,0],[.2,-.2,0],[.2,.2,0]])

    def proxy(self,a,b,first=None,last=None):
        return m.geometry_proxy(self.square(a),self.square(b),a,b,np.eye(4)if first is None else first,
            np.eye(4)if last is None else last,np.asarray([[100,0,200],[0,100,200],[0,0,1]]),(400,400))

    def test_lateral_constant_z_closes20percent_without_image_expansion(self):
        p=self.proxy([6,0,8],[0,0,8])
        self.assertAlmostEqual(p['radialCenterLogRatio'],np.log(1.25),places=12)
        self.assertAlmostEqual(p['proxyLinearLogGrowthLower'],0.,places=12)
        self.assertGreater(p['angularRmsLogRatio'],0.)

    def test_constant_range_orbit_can_expand_image(self):
        p=self.proxy([0,0,10],[6,0,8])
        self.assertAlmostEqual(p['radialCenterLogRatio'],0.,places=12)
        self.assertAlmostEqual(p['proxyLinearLogGrowthLower'],np.log(1.25),places=12)

    def test_axial_fixed_surface_scale_matches_inverse_depth(self):
        p=self.proxy([0,0,10],[0,0,8])
        self.assertAlmostEqual(p['radialCenterLogRatio'],np.log(1.25),places=12)
        self.assertAlmostEqual(p['proxyLinearLogGrowthLower'],np.log(1.25),places=12)

    def test_camera_rotation_derotation_removes_projective_scale(self):
        angle=.3;r=np.asarray([[np.cos(angle),0,np.sin(angle)],[0,1,0],[-np.sin(angle),0,np.cos(angle)]])
        last=np.eye(4);last[:3,:3]=r
        p=self.proxy([2,0,8],[2,0,8],last=last)
        self.assertAlmostEqual(p['radialCenterLogRatio'],0.,places=12)
        self.assertAlmostEqual(p['proxyLinearLogGrowthLower'],0.,places=12)

    def test_nonpositive_depth_is_explicit_unavailable(self):
        p=self.proxy([0,0,-10],[0,0,-8])
        self.assertEqual(p['status'],'nonpositive-proxy-depth-optical-unavailable')
        self.assertNotIn('forward',p)

    def test_object_yaw_changes_surface_expansion_at_constant_center_range(self):
        angle=.6;r=np.asarray([[np.cos(angle),0,np.sin(angle)],[0,1,0],[-np.sin(angle),0,np.cos(angle)]])
        center=np.asarray([0.,0.,8.]);flat=self.square(center)
        oblique=(flat-center)@r.T+center
        p=m.geometry_proxy(oblique,flat,center,center,np.eye(4),np.eye(4),
            np.asarray([[100,0,200],[0,100,200],[0,0,1]]),(400,400))
        self.assertAlmostEqual(p['radialCenterLogRatio'],0.,places=12)
        self.assertGreater(p['proxyLinearLogGrowthLower'],.05)

    def test_counterfactual_source_is_fixed_nearest600ms_not_best_result(self):
        frames=[dict(token=str(t),timestampUs=t)for t in (100_000,200_000,400_000,600_000)]
        current=dict(token='end',timestampUs=800_000)
        self.assertEqual(m.counterfactual_source(frames,current,{'100000','200000','400000'})['token'],'200000')
        self.assertIsNone(m.counterfactual_source(frames,current,set()))


if __name__=='__main__':unittest.main()
