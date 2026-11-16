"""M3G DIS comparison: bounded dense optical flow, not an app fallback.

DIS provides a spatially propagated flow field rather than independent corner
tracks. Samples remain texture-checked, limited to 64 points and verified by the
same forward/backward, photometric, spread, pose and looming gates as LK R1.
OpenCV DIS MEDIUM defaults are pinned below; no new model or installation.
"""

from types import MappingProxyType

import cv2
import numpy as np

import assist_scene_window_loom as sparse


POLICY=MappingProxyType({**sparse.POLICY,"denseAlgorithm":"DIS-MEDIUM",
                         "denseGridSide":10,"denseTextureVarianceFloor":16.,
                         "densePatchSize":8,"densePatchStride":3,
                         "denseFinestScale":1,"denseGradientIterations":25,
                         "denseVariationalIterations":5})


def _dense_seed(image,box,others,transform):
    tile=sparse._tile(image,image,box,box,transform)
    if tile is None: return None
    pixels,_,mapping=tile
    mask=sparse._mask(pixels.shape,box,others,mapping)
    rect=sparse.base._warp_rect(box,mapping)
    size=sparse.base._size(rect)
    xs=np.linspace(rect[0]+.15*size[0],rect[2]-.15*size[0],POLICY["denseGridSide"])
    ys=np.linspace(rect[1]+.15*size[1],rect[3]-.15*size[1],POLICY["denseGridSide"])
    candidates=np.array([(x,y) for y in ys for x in xs],np.float32)
    ix=np.clip(np.rint(candidates[:,0]).astype(int),0,pixels.shape[1]-1)
    iy=np.clip(np.rint(candidates[:,1]).astype(int),0,pixels.shape[0]-1)
    values=pixels.astype(np.float32)
    mean=cv2.boxFilter(values,-1,(7,7),normalize=True)
    variance=cv2.boxFilter(values*values,-1,(7,7),normalize=True)-mean*mean
    usable=(mask[iy,ix]>0)&(variance[iy,ix]>=POLICY["denseTextureVarianceFloor"])
    candidates=candidates[usable]
    if len(candidates)<POLICY["minPoints"]: return None
    if len(candidates)>POLICY["maxPoints"]:
        candidates=candidates[np.linspace(0,len(candidates)-1,POLICY["maxPoints"]).astype(int)]
    return sparse.base._project(candidates,np.linalg.inv(mapping)).astype(np.float32)


def _sample(field,points):
    x=points[:,0].astype(np.float32).reshape(-1,1)
    y=points[:,1].astype(np.float32).reshape(-1,1)
    values=cv2.remap(field,x,y,cv2.INTER_LINEAR,borderMode=cv2.BORDER_CONSTANT,borderValue=0)[:,0]
    valid=(np.isfinite(points).all(axis=1)&(points[:,0]>=1)&(points[:,1]>=1)
           &(points[:,0]<field.shape[1]-2)&(points[:,1]<field.shape[0]-2))
    return values,valid


class DenseWindowLoom(sparse.CumulativeWindowLoom):
    """One DIS method trial, using exactly the cumulative R1 evidence rules."""

    def __init__(self,*,native_detail=True):
        super().__init__(native_detail=native_detail)
        self._dis=cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
        self._dis.setFinestScale(POLICY["denseFinestScale"])
        self._dis.setPatchSize(POLICY["densePatchSize"])
        self._dis.setPatchStride(POLICY["densePatchStride"])
        self._dis.setGradientDescentIterations(POLICY["denseGradientIterations"])
        self._dis.setVariationalRefinementIterations(POLICY["denseVariationalIterations"])
        self._dis.setUseMeanNormalization(True)
        self._dis.setUseSpatialPropagation(True)

    def _new_points(self,*args):
        return _dense_seed(*args)

    def _track_flow(self,old,new,tube,current,homography,transform,others):
        if len(tube.points)<POLICY["minPoints"]:
            return None,"insufficient-object-flow"
        tile=sparse._tile(old,new,tube.box.xyxy,current.xyxy,transform)
        if tile is None: return None,"invalid-object-crop"
        p,q,mapping=tile
        if min(p.shape)<2*POLICY["densePatchSize"]:
            return None,"insufficient-dense-support"
        try:
            forward=self._dis.calc(p,q,None)
            backward=self._dis.calc(q,p,None)
        except cv2.error:
            return None,"dense-flow-unavailable"
        a=sparse.base._project(tube.points,mapping).astype(np.float32)
        displacement,ok=_sample(forward,a)
        b=a+displacement
        reverse,rev=_sample(backward,b)
        return sparse._validate_flow(p,q,a,b,b+reverse,ok,rev,tube,current,homography,mapping,others)
