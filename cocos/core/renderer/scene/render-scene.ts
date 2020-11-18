/*
 Copyright (c) 2020 Xiamen Yaji Software Co., Ltd.

 https://www.cocos.com/

 Permission is hereby granted, free of charge, to any person obtaining a copy
 of this software and associated engine source code (the "Software"), a limited,
 worldwide, royalty-free, non-assignable, revocable and non-exclusive license
 to use Cocos Creator solely to develop games on your target platforms. You shall
 not use Cocos Creator software for developing other software or tools that's
 used for developing games. You are not granted to publish, distribute,
 sublicense, and/or sell copies of Cocos Creator.

 The software or tools in this License Agreement are licensed, not sold.
 Xiamen Yaji Software Co., Ltd. reserves all rights not expressly granted to you.

 THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 THE SOFTWARE.
 */

import { IBArray } from '../../assets/mesh';
import { AABB, intersect, Ray, Triangle } from '../../geometry';
import { PrimitiveMode } from '../../gfx/define';
import { Mat4, Vec3 } from '../../math';
import { RecyclePool } from '../../memop';
import { Root } from '../../root';
import { Node } from '../../scene-graph';
import { Layers } from '../../scene-graph/layers';
import { Camera } from './camera';
import { DirectionalLight } from './directional-light';
import { Model, ModelType } from './model';
import { SphereLight } from './sphere-light';
import { SpotLight } from './spot-light';
import { PREVIEW } from 'internal:constants';
import { TransformBit } from '../../scene-graph/node-enum';
import { legacyCC } from '../../global-exports';
import { ScenePool, SceneView, ModelArrayPool, ModelArrayHandle, SceneHandle, NULL_HANDLE, freeHandleArray, ModelPool,LightArrayHandle, LightArrayPool } from '../core/memory-pools';

export interface IRenderSceneInfo {
    name: string;
}

export interface ISceneNodeInfo {
    name: string;
    isStatic?: boolean;
    // parent: Node;
}

export interface IRaycastResult {
    node: Node;
    distance: number;
}

export class RenderScene {

    get root (): Root {
        return this._root;
    }

    get name (): string {
        return this._name;
    }

    get cameras (): Camera[] {
        return this._cameras;
    }

    get mainLight (): DirectionalLight | null {
        return this._mainLight;
    }

    get sphereLights (): SphereLight[] {
        return this._sphereLights;
    }

    get spotLights (): SpotLight[] {
        return this._spotLights;
    }

    get models (): Model[] {
        return this._models;
    }

    /**
     * @zh
     * 获取 raycastAllCanvas 后的检测结果
     */
    get rayResultCanvas () {
        return resultCanvas;
    }

    /**
     * @zh
     * 获取 raycastAllModels 后的检测结果
     */
    get rayResultModels () {
        return resultModels;
    }

    /**
     * @zh
     * 获取 raycastAll 后的检测结果
     */
    get rayResultAll () {
        return resultAll;
    }

    /**
     * @zh
     * 获取 raycastSingleModel 后的检测结果
     */
    get rayResultSingleModel () {
        return resultSingleModel;
    }

    get handle () : SceneHandle {
        return this._scenePoolHandle;
    }

    public static registerCreateFunc (root: Root) {
        root._createSceneFun = (_root: Root): RenderScene => new RenderScene(_root);
    }

    private _root: Root;
    private _name: string = '';
    private _cameras: Camera[] = [];
    private _models: Model[] = [];
    private _directionalLights: DirectionalLight[] = [];
    private _sphereLights: SphereLight[] = [];
    private _spotLights: SpotLight[] = [];
    private _mainLight: DirectionalLight | null = null;
    private _modelId: number = 0;
    private _scenePoolHandle: SceneHandle = NULL_HANDLE;
    private _modelArrayHandle: ModelArrayHandle = NULL_HANDLE;
    private _sphereLightsHandle: LightArrayHandle = NULL_HANDLE;
    private _spotLightsHandle: LightArrayHandle = NULL_HANDLE;

    constructor (root: Root) {
        this._root = root;
        this._createHandles();
    }

    public initialize (info: IRenderSceneInfo): boolean {
        this._name = info.name;
        this._createHandles();
        return true;
    }

    public update (stamp: number) {
        const mainLight = this._mainLight;
        if (mainLight) {
            mainLight.update();
        }

        const sphereLights = this._sphereLights;
        for (let i = 0; i < sphereLights.length; i++) {
            const light = sphereLights[i];
            light.update();
        }

        const spotLights = this._spotLights;
        for (let i = 0; i < spotLights.length; i++) {
            const light = spotLights[i];
            light.update();
        }

        const models = this._models;
        for (let i = 0; i < models.length; i++) {
            const model = models[i];

            if (model.enabled) {
                model.updateTransform(stamp);
                model.updateUBOs(stamp);
            }
        }
    }

    public destroy () {
        this.removeCameras();
        this.removeSphereLights();
        this.removeSpotLights();
        this.removeModels();
        if (this._modelArrayHandle) {
            ModelArrayPool.free(this._modelArrayHandle);
            this._modelArrayHandle = NULL_HANDLE;
        }
        if (this._scenePoolHandle) {
            ScenePool.free(this._scenePoolHandle);
            this._scenePoolHandle = NULL_HANDLE;
        }
        if (this._sphereLightsHandle) {
            LightArrayPool.free(this._sphereLightsHandle);
            this._sphereLightsHandle = NULL_HANDLE;
        }
        if (this._spotLightsHandle) {
            LightArrayPool.free(this._spotLightsHandle);
            this._spotLightsHandle = NULL_HANDLE;
        }
    }

    public addCamera (cam: Camera) {
        cam.attachToScene(this);
        this._cameras.push(cam);
    }

    public removeCamera (camera: Camera) {
        for (let i = 0; i < this._cameras.length; ++i) {
            if (this._cameras[i] === camera) {
                this._cameras.splice(i, 1);
                camera.detachFromScene();
                return;
            }
        }
    }

    public removeCameras () {
        for (const camera of this._cameras) {
            camera.detachFromScene();
        }
        this._cameras.splice(0);
    }

    public setMainLight (dl: DirectionalLight) {
        this._mainLight = dl;
        ScenePool.set(this._scenePoolHandle, SceneView.MAIN_LIGHT, dl.handle);
    }

    public unsetMainLight (dl: DirectionalLight) {
        if (this._mainLight === dl) {
            const dlList = this._directionalLights;
            if (dlList.length) {
                this._mainLight = dlList[dlList.length - 1];
                if (this._mainLight.node) { // trigger update
                    this._mainLight.node.hasChangedFlags |= TransformBit.ROTATION;
                }
            } else {
                this._mainLight = null;
            }
        }
    }

    public addDirectionalLight (dl: DirectionalLight) {
        dl.attachToScene(this);
        this._directionalLights.push(dl);
    }

    public removeDirectionalLight (dl: DirectionalLight) {
        for (let i = 0; i < this._directionalLights.length; ++i) {
            if (this._directionalLights[i] === dl) {
                dl.detachFromScene();
                this._directionalLights.splice(i, 1);
                return;
            }
        }
    }

    public addSphereLight (pl: SphereLight) {
        pl.attachToScene(this);
        this._sphereLights.push(pl);
        LightArrayPool.push(this._sphereLightsHandle, pl.handle);
    }

    public removeSphereLight (pl: SphereLight) {
        for (let i = 0; i < this._sphereLights.length; ++i) {
            if (this._sphereLights[i] === pl) {
                pl.detachFromScene();
                this._sphereLights.splice(i, 1);
                LightArrayPool.erase(this._sphereLightsHandle, i)
                return;
            }
        }
    }

    public addSpotLight (sl: SpotLight) {
        sl.attachToScene(this);
        this._spotLights.push(sl);
        LightArrayPool.push(this._spotLightsHandle, sl.handle);
    }

    public removeSpotLight (sl: SpotLight) {
        for (let i = 0; i < this._spotLights.length; ++i) {
            if (this._spotLights[i] === sl) {
                sl.detachFromScene();
                this._spotLights.splice(i, 1);
                LightArrayPool.erase(this._spotLightsHandle, i);
                return;
            }
        }
    }

    public removeSphereLights () {
        for (let i = 0; i < this._sphereLights.length; ++i) {
            this._sphereLights[i].detachFromScene();
        }
        this._sphereLights.length = 0;
        LightArrayPool.clear(this._sphereLightsHandle);
    }

    public removeSpotLights () {
        for (let i = 0; i < this._spotLights.length; ++i) {
            this._spotLights[i].detachFromScene();
        }
        this._spotLights = [];
        LightArrayPool.clear(this._spotLightsHandle);
    }

    public addModel (m: Model) {
        m.attachToScene(this);
        this._models.push(m);
        ModelArrayPool.push(this._modelArrayHandle, m.handle);
    }

    public removeModel (model: Model) {
        for (let i = 0; i < this._models.length; ++i) {
            if (this._models[i] === model) {
                model.detachFromScene();
                this._models.splice(i, 1);
                ModelArrayPool.erase(this._modelArrayHandle, i);
                return;
            }
        }
    }

    public removeModels () {
        for (const m of this._models) {
            m.detachFromScene();
            m.destroy();
        }
        this._models.length = 0;
        ModelArrayPool.clear(this._modelArrayHandle);
    }

    public onGlobalPipelineStateChanged () {
        for (const m of this._models) {
            m.onGlobalPipelineStateChanged();
        }
    }

    public generateModelId (): number {
        return this._modelId++;
    }

    /**
     * @en
     * Cast a ray into the scene, record all the intersected models and ui2d nodes in the result array
     * @param worldRay the testing ray
     * @param mask the layer mask to filter the models
     * @param distance the max distance , Infinity by default
     * @returns boolean , ray is hit or not
     * @note getter of this.rayResultAll can get recently result
     * @zh
     * 传入一条射线检测场景中所有的 3D 模型和 UI2D Node
     * @param worldRay 世界射线
     * @param mask mask 用于标记所有要检测的层，默认为 Default | UI2D
     * @param distance 射线检测的最大距离, 默认为 Infinity
     * @returns boolean , 射线是否有击中
     * @note 通过 this.rayResultAll 可以获取到最近的结果
     */
    public raycastAll (worldRay: Ray, mask = Layers.Enum.DEFAULT | Layers.Enum.UI_2D, distance = Infinity): boolean {
        const r_3d = this.raycastAllModels(worldRay, mask, distance);
        const r_ui2d = this.raycastAllCanvas(worldRay, mask, distance);
        const isHit = r_3d || r_ui2d;
        resultAll.length = 0;
        if (isHit) {
            Array.prototype.push.apply(resultAll, resultModels);
            Array.prototype.push.apply(resultAll, resultCanvas);
        }
        return isHit;
    }

    /**
     * @en
     * Cast a ray into the scene, record all the intersected models in the result array
     * @param worldRay the testing ray
     * @param mask the layer mask to filter the models
     * @param distance the max distance , Infinity by default
     * @returns boolean , ray is hit or not
     * @note getter of this.rayResultModels can get recently result
     * @zh
     * 传入一条射线检测场景中所有的 3D 模型。
     * @param worldRay 世界射线
     * @param mask 用于标记所有要检测的层，默认为 Default
     * @param distance 射线检测的最大距离, 默认为 Infinity
     * @returns boolean , 射线是否有击中
     * @note 通过 this.rayResultModels 可以获取到最近的结果
     */
    public raycastAllModels (worldRay: Ray, mask = Layers.Enum.DEFAULT, distance = Infinity): boolean {
        pool.reset();
        for (const m of this._models) {
            const transform = m.transform;
            if (!transform || !m.enabled || !(m.node.layer & (mask & ~Layers.Enum.IGNORE_RAYCAST)) || !m.worldBounds) { continue; }
            // broadphase
            let d = intersect.rayAABB(worldRay, m.worldBounds);
            if (d <= 0 || d >= distance) { continue; }
            if (m.type === ModelType.DEFAULT) {
                // transform ray back to model space
                Mat4.invert(m4, transform.getWorldMatrix(m4));
                Vec3.transformMat4(modelRay.o, worldRay.o, m4);
                Vec3.normalize(modelRay.d, Vec3.transformMat4Normal(modelRay.d, worldRay.d, m4));
                d = Infinity; const subModels = m.subModels;
                for (let i = 0; i < subModels.length; ++i) {
                    const subMesh = subModels[i].subMesh;
                    if (subMesh && subMesh.geometricInfo) {
                        const { positions: vb, indices: ib, doubleSided: sides } = subMesh.geometricInfo;
                        narrowphase(vb, ib!, subMesh.primitiveMode, sides!, distance);
                        d = Math.min(d, narrowDis * Vec3.multiply(v3, modelRay.d, transform.worldScale).length());
                    }
                }
            }
            if (d < distance) {
                const r = pool.add();
                r.node = m.node;
                r.distance = d;
                resultModels[pool.length - 1] = r;
            }
        }
        resultModels.length = pool.length;
        return resultModels.length > 0;
    }

    /**
     * @en
     * Before you raycast the model, make sure the model is not null
     * @param worldRay the testing ray
     * @param model the testing model
     * @param mask the layer mask to filter the models
     * @param distance the max distance , Infinity by default
     * @returns boolean , ray is hit or not
     * @zh
     * 传入一条射线和一个 3D 模型进行射线检测。
     * @param worldRay 世界射线
     * @param model 进行检测的模型
     * @param mask 用于标记所有要检测的层，默认为 Default
     * @param distance 射线检测的最大距离, 默认为 Infinity
     * @returns boolean , 射线是否有击中
     */
    public raycastSingleModel (worldRay: Ray, model: Model, mask = Layers.Enum.DEFAULT, distance = Infinity): boolean {
        if (PREVIEW) {
            if (model == null) { console.error(' 检测前请保证 model 不为 null '); }
        }
        pool.reset();
        const m = model;
        const transform = m.transform;
        if (!transform || !m.enabled || !(m.node.layer & (mask & ~Layers.Enum.IGNORE_RAYCAST)) || !m.worldBounds) { return false; }
        // broadphase
        let d = intersect.rayAABB(worldRay, m.worldBounds);
        if (d <= 0 || d >= distance) { return false; }
        if (m.type === ModelType.DEFAULT) {
            // transform ray back to model space
            Mat4.invert(m4, transform.getWorldMatrix(m4));
            Vec3.transformMat4(modelRay.o, worldRay.o, m4);
            Vec3.normalize(modelRay.d, Vec3.transformMat4Normal(modelRay.d, worldRay.d, m4));
            d = Infinity; const subModels = m.subModels;
            for (let i = 0; i < subModels.length; ++i) {
                const subMesh = subModels[i].subMesh;
                if (subMesh && subMesh.geometricInfo) {
                    const { positions: vb, indices: ib, doubleSided: sides } = subMesh.geometricInfo;
                    narrowphase(vb, ib!, subMesh.primitiveMode, sides!, distance);
                    d = Math.min(d, narrowDis * Vec3.multiply(v3, modelRay.d, transform.worldScale).length());
                }
            }
        }
        if (d < distance) {
            const r = pool.add();
            r.node = m.node;
            r.distance = d;
            resultSingleModel[pool.length - 1] = r;
        }
        resultSingleModel.length = pool.length;
        return resultSingleModel.length > 0;
    }

    /**
     * @en
     * Cast a ray into the scene, detect all canvas and its children
     * @param worldRay the testing ray
     * @param mask the layer mask to filter all ui2d aabb
     * @param distance the max distance , Infinity by default
     * @returns boolean , ray is hit or not
     * @note getter of this.rayResultCanvas can get recently result
     * @zh
     * 传入一条射线检测场景中所有的 Canvas 以及 Canvas 下的 Node
     * @param worldRay 世界射线
     * @param mask 用于标记所有要检测的层，默认为 UI_2D
     * @param distance 射线检测的最大距离, 默认为 Infinity
     * @returns boolean , 射线是否有击中
     * @note 通过 this.rayResultCanvas 可以获取到最近的结果
     */
    public raycastAllCanvas (worldRay: Ray, mask = Layers.Enum.UI_2D, distance = Infinity): boolean {
        poolUI.reset();
        const canvasComs = legacyCC.director.getScene().getComponentsInChildren(legacyCC.Canvas);
        if (canvasComs != null && canvasComs.length > 0) {
            for (let i = 0; i < canvasComs.length; i++) {
                const canvasNode = canvasComs[i].node;
                if (canvasNode != null && canvasNode.active) {
                    this._raycastUI2DNodeRecursiveChildren(worldRay, canvasNode, mask, distance);
                }
            }
        }
        resultCanvas.length = poolUI.length;
        return resultCanvas.length > 0;
    }

    private _raycastUI2DNode (worldRay: Ray, ui2dNode: Node, mask = Layers.Enum.UI_2D, distance = Infinity) {
        if (PREVIEW) {
            if (ui2dNode == null) { console.error('make sure UINode is not null'); }
        }
        const uiTransform = ui2dNode._uiProps.uiTransformComp;
        if (uiTransform == null || ui2dNode.layer & Layers.Enum.IGNORE_RAYCAST || !(ui2dNode.layer & mask)) { return; }
        uiTransform.getComputeAABB(aabbUI);
        const d = intersect.rayAABB(worldRay, aabbUI);

        if (d <= 0) {
            return;
        } else if (d < distance) {
            const r = poolUI.add();
            r.node = ui2dNode;
            r.distance = d;
            return r;
        }
    }

    private _raycastUI2DNodeRecursiveChildren (worldRay: Ray, parent: Node, mask = Layers.Enum.UI_2D, distance = Infinity) {
        const result = this._raycastUI2DNode(worldRay, parent, mask, distance);
        if (result != null) {
            resultCanvas[poolUI.length - 1] = result;
        }
        for (const node of parent.children) {
            if (node != null && node.active) {
                this._raycastUI2DNodeRecursiveChildren(worldRay, node, mask, distance);
            }
        }
    }

    private _createHandles () {
        if (!this._modelArrayHandle) {
            this._modelArrayHandle = ModelArrayPool.alloc();
            this._scenePoolHandle = ScenePool.alloc();
            ScenePool.set(this._scenePoolHandle, SceneView.MODEL_ARRAY, this._modelArrayHandle);

            this._spotLightsHandle = LightArrayPool.alloc();
            ScenePool.set(this._scenePoolHandle, SceneView.SPOT_LIGHT_ARRAY, this._spotLightsHandle);

            this._sphereLightsHandle = LightArrayPool.alloc();
            ScenePool.set(this._scenePoolHandle, SceneView.SPHERE_LIGHT_ARRAY, this._sphereLightsHandle);
        }
    }
}

const modelRay = Ray.create();
const v3 = new Vec3();
const m4 = new Mat4();
let narrowDis = Infinity;
const tri = Triangle.create();
const pool = new RecyclePool<IRaycastResult>(() => {
    return { node: null!, distance: Infinity };
}, 8);
const resultModels: IRaycastResult[] = [];
/** Canvas raycast result pool */
const aabbUI = new AABB();
const poolUI = new RecyclePool<IRaycastResult>(() => {
    return { node: null!, distance: Infinity };
}, 8);
const resultCanvas: IRaycastResult[] = [];
/** raycast all */
const resultAll: IRaycastResult[] = [];
/** raycast single model */
const resultSingleModel: IRaycastResult[] = [];

const narrowphase = (vb: Float32Array, ib: IBArray, pm: PrimitiveMode, sides: boolean, distance = Infinity) => {
    narrowDis = distance;
    if (pm === PrimitiveMode.TRIANGLE_LIST) {
        const cnt = ib.length;
        for (let j = 0; j < cnt; j += 3) {
            const i0 = ib[j] * 3;
            const i1 = ib[j + 1] * 3;
            const i2 = ib[j + 2] * 3;
            Vec3.set(tri.a, vb[i0], vb[i0 + 1], vb[i0 + 2]);
            Vec3.set(tri.b, vb[i1], vb[i1 + 1], vb[i1 + 2]);
            Vec3.set(tri.c, vb[i2], vb[i2 + 1], vb[i2 + 2]);
            const dist = intersect.rayTriangle(modelRay, tri, sides);
            if (dist <= 0 || dist >= narrowDis) { continue; }
            narrowDis = dist;
        }
    } else if (pm === PrimitiveMode.TRIANGLE_STRIP) {
        const cnt = ib.length - 2;
        let rev = 0;
        for (let j = 0; j < cnt; j += 1) {
            const i0 = ib[j - rev] * 3;
            const i1 = ib[j + rev + 1] * 3;
            const i2 = ib[j + 2] * 3;
            Vec3.set(tri.a, vb[i0], vb[i0 + 1], vb[i0 + 2]);
            Vec3.set(tri.b, vb[i1], vb[i1 + 1], vb[i1 + 2]);
            Vec3.set(tri.c, vb[i2], vb[i2 + 1], vb[i2 + 2]);
            rev = ~rev;
            const dist = intersect.rayTriangle(modelRay, tri, sides);
            if (dist <= 0 || dist >= narrowDis) { continue; }
            narrowDis = dist;
        }
    } else if (pm === PrimitiveMode.TRIANGLE_FAN) {
        const cnt = ib.length - 1;
        const i0 = ib[0] * 3;
        Vec3.set(tri.a, vb[i0], vb[i0 + 1], vb[i0 + 2]);
        for (let j = 1; j < cnt; j += 1) {
            const i1 = ib[j] * 3;
            const i2 = ib[j + 1] * 3;
            Vec3.set(tri.b, vb[i1], vb[i1 + 1], vb[i1 + 2]);
            Vec3.set(tri.c, vb[i2], vb[i2 + 1], vb[i2 + 2]);
            const dist = intersect.rayTriangle(modelRay, tri, sides);
            if (dist <= 0 || dist >= narrowDis) { continue; }
            narrowDis = dist;
        }
    }
};
