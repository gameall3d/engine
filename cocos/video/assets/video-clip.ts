/*
 Copyright (c) 2017-2018 Xiamen Yaji Software Co., Ltd.

 http://www.cocos.com

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

/**
 * @category component/audio
 */

import { Asset } from '../../core/assets';
import { ccclass, property } from '../../core/data/class-decorator';
import { legacyCC } from '../../core/global-exports';

/**
 * @en
 * The video clip asset.
 * @zh
 * 视频片段资源。
 */
@ccclass('cc.VideoClip')
export class VideoClip extends Asset {

    @property
    protected _duration = 0;
    protected _video: any = null;

    constructor () {
        super();
        this.loaded = false;
    }

    set _nativeAsset (clip: any) {
        this._video = clip;
        if (clip) {
            this._duration = clip.duration;
            this.loaded = true;
        } else {
            this._duration = 0;
            this.loaded = false;
        }
    }

    get _nativeAsset () {
        return this._video;
    }
}