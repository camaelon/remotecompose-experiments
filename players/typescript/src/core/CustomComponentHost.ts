// The hook a platform gives the engine for custom components (LAYOUT_CUSTOM, op 93):
// content the document describes but cannot draw itself — an embedded document, a video, a
// web page. The engine lays the component out like any other and, when it paints, hands the
// host the component's config string and its content box; the host draws whatever the
// config names into (0,0)..(w,h) of the paint context, which is already translated there.
//
// Mirrors rccore/CustomComponentHost.h in the C++ player.

import type { PaintContext } from './PaintContext';

export interface CustomComponentHost {
    /**
     * Draw the component named by `config` into the box (0,0)..(w,h). `timeSec` is the
     * host document's animation time. Returns true when the config was understood, whether
     * or not anything was drawn yet.
     */
    drawCustom(componentId: number, config: string, pc: PaintContext,
               w: number, h: number, timeSec: number): boolean;
}
