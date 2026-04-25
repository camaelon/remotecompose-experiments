#include "rccore/operations/DrawOperations.h"
#include "rccore/RemoteContext.h"
#include "rccore/PaintContext.h"
#include "rccore/CoreDocument.h"
#include "rccore/Utils.h"

namespace rccore {

// ── TextData ──────────────────────────────────────────────────────────
void TextData::apply(RemoteContext& context) {
    // TS: no mode check — runs in ALL modes
    context.loadText(textId, text);
}

// ── BitmapData ────────────────────────────────────────────────────────
void BitmapData::apply(RemoteContext& context) {
    // TS: no mode check — runs in ALL modes
    context.loadBitmap(imageId, widthAndType, heightAndEncoding, bitmap);
}

// ── PathData ──────────────────────────────────────────────────────────
void PathDataOp::apply(RemoteContext& context) {
    // TS: no mode check — runs in ALL modes
    int winding = idAndWinding >> 24;
    int id = idAndWinding & 0xFFFFFF;
    context.loadPathData(id, winding, pathData);
}

// ── PaintValues ───────────────────────────────────────────────────────
void PaintValues::apply(RemoteContext& context) {
    if (context.getMode() == ContextMode::PAINT) {
        auto* pc = context.getPaintContext();
        if (pc) pc->applyPaint(bundle);
    }
}

// ── DrawRect ──────────────────────────────────────────────────────────
void DrawRect::registerListening(RemoteContext& context) {
    Utils::registerFloatVar(left, context, this);
    Utils::registerFloatVar(top, context, this);
    Utils::registerFloatVar(right, context, this);
    Utils::registerFloatVar(bottom, context, this);
}

void DrawRect::updateVariables(RemoteContext& context) {
    oLeft = Utils::resolveFloat(left, context);
    oTop = Utils::resolveFloat(top, context);
    oRight = Utils::resolveFloat(right, context);
    oBottom = Utils::resolveFloat(bottom, context);
}

void DrawRect::apply(RemoteContext& context) {
    if (context.getMode() == ContextMode::PAINT) {
        auto* pc = context.getPaintContext();
        if (pc) {
            pc->drawRect(oLeft, oTop, oRight, oBottom);
        }
    }
}

// ── DrawCircle ────────────────────────────────────────────────────────
void DrawCircle::registerListening(RemoteContext& context) {
    Utils::registerFloatVar(cx, context, this);
    Utils::registerFloatVar(cy, context, this);
    Utils::registerFloatVar(radius, context, this);
}

void DrawCircle::updateVariables(RemoteContext& context) {
    oCx = Utils::resolveFloat(cx, context);
    oCy = Utils::resolveFloat(cy, context);
    oRadius = Utils::resolveFloat(radius, context);
}

void DrawCircle::apply(RemoteContext& context) {
    if (context.getMode() == ContextMode::PAINT) {
        auto* pc = context.getPaintContext();
        if (pc) pc->drawCircle(oCx, oCy, oRadius);
    }
}

// ── DrawLine ──────────────────────────────────────────────────────────
void DrawLine::registerListening(RemoteContext& context) {
    Utils::registerFloatVar(x1, context, this);
    Utils::registerFloatVar(y1, context, this);
    Utils::registerFloatVar(x2, context, this);
    Utils::registerFloatVar(y2, context, this);
}

void DrawLine::updateVariables(RemoteContext& context) {
    oX1 = Utils::resolveFloat(x1, context);
    oY1 = Utils::resolveFloat(y1, context);
    oX2 = Utils::resolveFloat(x2, context);
    oY2 = Utils::resolveFloat(y2, context);
}

void DrawLine::apply(RemoteContext& context) {
    if (context.getMode() == ContextMode::PAINT) {
        auto* pc = context.getPaintContext();
        if (pc) pc->drawLine(oX1, oY1, oX2, oY2);
    }
}

// ── DrawOval ──────────────────────────────────────────────────────────
void DrawOval::registerListening(RemoteContext& context) {
    Utils::registerFloatVar(left, context, this);
    Utils::registerFloatVar(top, context, this);
    Utils::registerFloatVar(right, context, this);
    Utils::registerFloatVar(bottom, context, this);
}

void DrawOval::updateVariables(RemoteContext& context) {
    oLeft = Utils::resolveFloat(left, context);
    oTop = Utils::resolveFloat(top, context);
    oRight = Utils::resolveFloat(right, context);
    oBottom = Utils::resolveFloat(bottom, context);
}

void DrawOval::apply(RemoteContext& context) {
    if (context.getMode() == ContextMode::PAINT) {
        auto* pc = context.getPaintContext();
        if (pc) pc->drawOval(oLeft, oTop, oRight, oBottom);
    }
}

// ── DrawRoundRect ─────────────────────────────────────────────────────
void DrawRoundRect::registerListening(RemoteContext& context) {
    Utils::registerFloatVar(left, context, this);
    Utils::registerFloatVar(top, context, this);
    Utils::registerFloatVar(right, context, this);
    Utils::registerFloatVar(bottom, context, this);
    Utils::registerFloatVar(radiusX, context, this);
    Utils::registerFloatVar(radiusY, context, this);
}

void DrawRoundRect::updateVariables(RemoteContext& context) {
    oLeft = Utils::resolveFloat(left, context);
    oTop = Utils::resolveFloat(top, context);
    oRight = Utils::resolveFloat(right, context);
    oBottom = Utils::resolveFloat(bottom, context);
    oRadiusX = Utils::resolveFloat(radiusX, context);
    oRadiusY = Utils::resolveFloat(radiusY, context);
}

void DrawRoundRect::apply(RemoteContext& context) {
    if (context.getMode() == ContextMode::PAINT) {
        auto* pc = context.getPaintContext();
        if (pc) pc->drawRoundRect(oLeft, oTop, oRight, oBottom,
                                  oRadiusX, oRadiusY);
    }
}

// ── DrawSector ────────────────────────────────────────────────────────
void DrawSector::registerListening(RemoteContext& context) {
    Utils::registerFloatVar(left, context, this);
    Utils::registerFloatVar(top, context, this);
    Utils::registerFloatVar(right, context, this);
    Utils::registerFloatVar(bottom, context, this);
    Utils::registerFloatVar(startAngle, context, this);
    Utils::registerFloatVar(sweepAngle, context, this);
}

void DrawSector::updateVariables(RemoteContext& context) {
    oLeft = Utils::resolveFloat(left, context);
    oTop = Utils::resolveFloat(top, context);
    oRight = Utils::resolveFloat(right, context);
    oBottom = Utils::resolveFloat(bottom, context);
    oStartAngle = Utils::resolveFloat(startAngle, context);
    oSweepAngle = Utils::resolveFloat(sweepAngle, context);
}

void DrawSector::apply(RemoteContext& context) {
    if (context.getMode() == ContextMode::PAINT) {
        auto* pc = context.getPaintContext();
        if (pc) pc->drawSector(oLeft, oTop, oRight, oBottom,
                               oStartAngle, oSweepAngle);
    }
}

// ── DrawArc ───────────────────────────────────────────────────────────
void DrawArc::registerListening(RemoteContext& context) {
    Utils::registerFloatVar(left, context, this);
    Utils::registerFloatVar(top, context, this);
    Utils::registerFloatVar(right, context, this);
    Utils::registerFloatVar(bottom, context, this);
    Utils::registerFloatVar(startAngle, context, this);
    Utils::registerFloatVar(sweepAngle, context, this);
}

void DrawArc::updateVariables(RemoteContext& context) {
    oLeft = Utils::resolveFloat(left, context);
    oTop = Utils::resolveFloat(top, context);
    oRight = Utils::resolveFloat(right, context);
    oBottom = Utils::resolveFloat(bottom, context);
    oStartAngle = Utils::resolveFloat(startAngle, context);
    oSweepAngle = Utils::resolveFloat(sweepAngle, context);
}

void DrawArc::apply(RemoteContext& context) {
    if (context.getMode() == ContextMode::PAINT) {
        auto* pc = context.getPaintContext();
        if (pc) pc->drawArc(oLeft, oTop, oRight, oBottom,
                            oStartAngle, oSweepAngle);
    }
}

// ── DrawPath ──────────────────────────────────────────────────────────
void DrawPath::apply(RemoteContext& context) {
    if (context.getMode() == ContextMode::PAINT) {
        auto* pc = context.getPaintContext();
        if (pc) pc->drawPath(pathId, 0.0f, 1.0f);
    }
}

// ── DrawTweenPath ─────────────────────────────────────────────────────
void DrawTweenPath::registerListening(RemoteContext& context) {
    Utils::registerFloatVar(tween, context, this);
    Utils::registerFloatVar(start, context, this);
    Utils::registerFloatVar(stop, context, this);
}

void DrawTweenPath::updateVariables(RemoteContext& context) {
    oTween = Utils::resolveFloat(tween, context);
    oStart = Utils::resolveFloat(start, context);
    oStop = Utils::resolveFloat(stop, context);
}

void DrawTweenPath::apply(RemoteContext& context) {
    if (context.getMode() == ContextMode::PAINT) {
        auto* pc = context.getPaintContext();
        if (pc) pc->drawTweenPath(path1Id, path2Id, oTween, oStart, oStop);
    }
}

// ── DrawBitmap ────────────────────────────────────────────────────────
void DrawBitmap::registerListening(RemoteContext& context) {
    Utils::registerFloatVar(left, context, this);
    Utils::registerFloatVar(top, context, this);
    Utils::registerFloatVar(right, context, this);
    Utils::registerFloatVar(bottom, context, this);
}

void DrawBitmap::updateVariables(RemoteContext& context) {
    oLeft = Utils::resolveFloat(left, context);
    oTop = Utils::resolveFloat(top, context);
    oRight = Utils::resolveFloat(right, context);
    oBottom = Utils::resolveFloat(bottom, context);
}

void DrawBitmap::apply(RemoteContext& context) {
    if (context.getMode() == ContextMode::PAINT) {
        auto* pc = context.getPaintContext();
        if (pc) pc->drawBitmap(imageId, oLeft, oTop, oRight, oBottom);
    }
}

// ── DrawBitmapInt ─────────────────────────────────────────────────────
void DrawBitmapInt::apply(RemoteContext& context) {
    if (context.getMode() == ContextMode::PAINT) {
        auto* pc = context.getPaintContext();
        if (pc) pc->drawBitmapInt(imageId, srcL, srcT, srcR, srcB,
                                  dstL, dstT, dstR, dstB, cdId);
    }
}

// ── DrawTextRun ───────────────────────────────────────────────────────
void DrawTextRun::registerListening(RemoteContext& context) {
    Utils::registerFloatVar(x, context, this);
    Utils::registerFloatVar(y, context, this);
}

void DrawTextRun::updateVariables(RemoteContext& context) {
    oX = Utils::resolveFloat(x, context);
    oY = Utils::resolveFloat(y, context);
}

void DrawTextRun::apply(RemoteContext& context) {
    if (context.getMode() == ContextMode::PAINT) {
        auto* pc = context.getPaintContext();
        if (pc) pc->drawTextRun(textId, start, end, contextStart, contextEnd,
                                oX, oY, rtl);
    }
}

// ── DrawTextAnchored ──────────────────────────────────────────────────
void DrawTextAnchored::registerListening(RemoteContext& context) {
    Utils::registerFloatVar(x, context, this);
    Utils::registerFloatVar(y, context, this);
    Utils::registerFloatVar(panX, context, this);
    Utils::registerFloatVar(panY, context, this);
}

void DrawTextAnchored::updateVariables(RemoteContext& context) {
    oX = Utils::resolveFloat(x, context);
    oY = Utils::resolveFloat(y, context);
    oPanX = Utils::resolveFloat(panX, context);
    oPanY = Utils::resolveFloat(panY, context);
}

void DrawTextAnchored::apply(RemoteContext& context) {
    if (context.getMode() == ContextMode::PAINT) {
        auto* pc = context.getPaintContext();
        if (pc) pc->drawTextAnchored(textId, oX, oY, oPanX, oPanY, flags);
    }
}

// ── DrawTextOnPath ────────────────────────────────────────────────────
void DrawTextOnPath::registerListening(RemoteContext& context) {
    Utils::registerFloatVar(hOffset, context, this);
    Utils::registerFloatVar(vOffset, context, this);
}

void DrawTextOnPath::updateVariables(RemoteContext& context) {
    oHOffset = Utils::resolveFloat(hOffset, context);
    oVOffset = Utils::resolveFloat(vOffset, context);
}

void DrawTextOnPath::apply(RemoteContext& context) {
    if (context.getMode() == ContextMode::PAINT) {
        auto* pc = context.getPaintContext();
        if (pc) pc->drawTextOnPath(textId, pathId, oHOffset, oVOffset);
    }
}

// ── ClipRect ──────────────────────────────────────────────────────────
void ClipRectOp::registerListening(RemoteContext& context) {
    Utils::registerFloatVar(left, context, this);
    Utils::registerFloatVar(top, context, this);
    Utils::registerFloatVar(right, context, this);
    Utils::registerFloatVar(bottom, context, this);
}

void ClipRectOp::updateVariables(RemoteContext& context) {
    oLeft = Utils::resolveFloat(left, context);
    oTop = Utils::resolveFloat(top, context);
    oRight = Utils::resolveFloat(right, context);
    oBottom = Utils::resolveFloat(bottom, context);
}

void ClipRectOp::apply(RemoteContext& context) {
    if (context.getMode() == ContextMode::PAINT) {
        auto* pc = context.getPaintContext();
        if (pc) pc->clipRect(oLeft, oTop, oRight, oBottom);
    }
}

// ── ClipPath ──────────────────────────────────────────────────────────
void ClipPathOp::apply(RemoteContext& context) {
    if (context.getMode() == ContextMode::PAINT) {
        auto* pc = context.getPaintContext();
        if (pc) pc->clipPath(pathId, 0);
    }
}

// ── Matrix operations ─────────────────────────────────────────────────
void MatrixSave::apply(RemoteContext& context) {
    if (context.getMode() == ContextMode::PAINT) {
        auto* pc = context.getPaintContext();
        if (pc) { pc->matrixSave(); pc->savePaint(); }
    }
}

void MatrixRestore::apply(RemoteContext& context) {
    if (context.getMode() == ContextMode::PAINT) {
        auto* pc = context.getPaintContext();
        if (pc) { pc->restorePaint(); pc->matrixRestore(); }
    }
}

// ── MatrixScale ───────────────────────────────────────────────────────
void MatrixScale::registerListening(RemoteContext& context) {
    Utils::registerFloatVar(sx, context, this);
    Utils::registerFloatVar(sy, context, this);
    Utils::registerFloatVar(cx, context, this);
    Utils::registerFloatVar(cy, context, this);
}

void MatrixScale::updateVariables(RemoteContext& context) {
    oSx = Utils::resolveFloat(sx, context);
    oSy = Utils::resolveFloat(sy, context);
    oCx = Utils::resolveFloat(cx, context);
    oCy = Utils::resolveFloat(cy, context);
}

void MatrixScale::apply(RemoteContext& context) {
    if (context.getMode() == ContextMode::PAINT) {
        auto* pc = context.getPaintContext();
        if (pc) pc->matrixScale(oSx, oSy, oCx, oCy);
    }
}

// ── MatrixTranslate ───────────────────────────────────────────────────
void MatrixTranslate::registerListening(RemoteContext& context) {
    Utils::registerFloatVar(dx, context, this);
    Utils::registerFloatVar(dy, context, this);
}

void MatrixTranslate::updateVariables(RemoteContext& context) {
    oDx = Utils::resolveFloat(dx, context);
    oDy = Utils::resolveFloat(dy, context);
}

void MatrixTranslate::apply(RemoteContext& context) {
    if (context.getMode() == ContextMode::PAINT) {
        auto* pc = context.getPaintContext();
        if (pc) pc->matrixTranslate(oDx, oDy);
    }
}

// ── MatrixRotate ──────────────────────────────────────────────────────
void MatrixRotate::registerListening(RemoteContext& context) {
    Utils::registerFloatVar(angle, context, this);
    Utils::registerFloatVar(cx, context, this);
    Utils::registerFloatVar(cy, context, this);
}

void MatrixRotate::updateVariables(RemoteContext& context) {
    oAngle = Utils::resolveFloat(angle, context);
    oCx = Utils::resolveFloat(cx, context);
    oCy = Utils::resolveFloat(cy, context);
}

void MatrixRotate::apply(RemoteContext& context) {
    if (context.getMode() == ContextMode::PAINT) {
        auto* pc = context.getPaintContext();
        if (pc) pc->matrixRotate(oAngle, oCx, oCy);
    }
}

// ── MatrixSkew ────────────────────────────────────────────────────────
void MatrixSkew::registerListening(RemoteContext& context) {
    Utils::registerFloatVar(sx, context, this);
    Utils::registerFloatVar(sy, context, this);
}

void MatrixSkew::updateVariables(RemoteContext& context) {
    oSx = Utils::resolveFloat(sx, context);
    oSy = Utils::resolveFloat(sy, context);
}

void MatrixSkew::apply(RemoteContext& context) {
    if (context.getMode() == ContextMode::PAINT) {
        auto* pc = context.getPaintContext();
        if (pc) pc->matrixSkew(oSx, oSy);
    }
}

// ── Theme ─────────────────────────────────────────────────────────────
void ThemeOp::apply(RemoteContext& context) {
    context.setTheme(theme);
}

// ── Data constants ────────────────────────────────────────────────────
// TS: all constant operations run in ALL modes (no mode check)
void FloatConstant::apply(RemoteContext& context) {
    context.loadFloat(id, value);
}

void IntegerConstant::apply(RemoteContext& context) {
    context.loadInteger(id, value);
}

void ColorConstant::apply(RemoteContext& context) {
    context.loadColor(id, color);
}

void BooleanConstant::apply(RemoteContext& context) {
    context.loadBoolean(id, value);
}

void LongConstant::apply(RemoteContext& context) {
    context.loadLong(id, value);
}

// ── RootContentBehavior ───────────────────────────────────────────────
void RootContentBehavior::apply(RemoteContext& context) {
    auto* doc = context.getDocument();
    if (doc) {
        doc->setRootContentBehavior(scroll, alignment, sizing, mode);
    }
}

// ── ShaderData ────────────────────────────────────────────────────────
void ShaderData::apply(RemoteContext& context) {
    context.loadShader(shaderID, this);
}

void ShaderData::read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
    auto op = std::make_unique<ShaderData>();
    op->shaderID = buf.readInt();
    op->shaderTextId = buf.readInt();
    int sizes = buf.readInt();
    int floatSize = sizes & 0xFF;
    int intSize = (sizes >> 8) & 0xFF;
    int bitmapSize = (sizes >> 16) & 0xFF;
    for (int i = 0; i < floatSize; i++) {
        ShaderData::FloatUniform u;
        u.name = buf.readUTF8();
        int len = buf.readInt();
        u.values.resize(len);
        for (int j = 0; j < len; j++) u.values[j] = buf.readFloat();
        op->floatUniforms.push_back(std::move(u));
    }
    for (int i = 0; i < intSize; i++) {
        ShaderData::IntUniform u;
        u.name = buf.readUTF8();
        int len = buf.readInt();
        u.values.resize(len);
        for (int j = 0; j < len; j++) u.values[j] = buf.readInt();
        op->intUniforms.push_back(std::move(u));
    }
    for (int i = 0; i < bitmapSize; i++) {
        ShaderData::BitmapUniform u;
        u.name = buf.readUTF8();
        u.bitmapId = buf.readInt();
        op->bitmapUniforms.push_back(std::move(u));
    }
    ops.push_back(std::move(op));
}

} // namespace rccore
