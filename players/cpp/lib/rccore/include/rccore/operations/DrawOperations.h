#pragma once
#include "rccore/Operation.h"
#include "rccore/WireBuffer.h"
#include "rccore/PaintBundle.h"
#include "rccore/RemoteContext.h"
#include <vector>

namespace rccore {

// ── TextData (102) ────────────────────────────────────────────────────
class TextData : public Operation {
public:
    int textId = 0;
    std::string text;

    std::string name() const override { return "DATA_TEXT"; }
    int opcode() const override { return 102; }
    std::vector<Field> fields() const override {
        return {{"textId", "INT", std::to_string(textId)}, {"text", "UTF8", text}};
    }
    void apply(RemoteContext& context) override;

    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<TextData>();
        op->textId = buf.declareId();
        op->text = buf.readUTF8();
        ops.push_back(std::move(op));
    }
};

// ── BitmapData (101) ──────────────────────────────────────────────────
class BitmapData : public Operation {
public:
    int imageId = 0;
    int widthAndType = 0;
    int heightAndEncoding = 0;
    std::vector<uint8_t> bitmap;

    std::string name() const override { return "DATA_BITMAP"; }
    int opcode() const override { return 101; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override;

    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<BitmapData>();
        op->imageId = buf.readId();
        op->widthAndType = buf.readInt();
        op->heightAndEncoding = buf.readInt();
        op->bitmap = buf.readBuffer();
        ops.push_back(std::move(op));
    }
};

// ── PathData (123) ────────────────────────────────────────────────────
class PathDataOp : public Operation {
public:
    int idAndWinding = 0;
    std::vector<float> pathData;

    std::string name() const override { return "PATH_DATA"; }
    int opcode() const override { return 123; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override;

    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<PathDataOp>();
        int32_t raw = buf.readInt();
        // As PathData.read: the id (low 24 bits) is resolved inside a pattern, and a NaN-boxed
        // value remapped unless it is a path command (ids <= DONE = 16).
        op->idAndWinding = (raw & ~0xFFFFFF) | (buf.remapId(raw & 0xFFFFFF) & 0xFFFFFF);
        int len = buf.readInt();
        op->pathData.resize(len);
        for (int i = 0; i < len; i++) {
            float v = buf.readFloat();
            int32_t b; memcpy(&b, &v, sizeof(b));
            op->pathData[i] = (RemapContext::isNaNBits(b) && (b & 0x3FFFFF) > 16) ? buf.remapNan(v) : v;
        }
        ops.push_back(std::move(op));
    }
};

// ── PaintValues (40) ─────────────────────────────────────────────────
class PaintValues : public Operation {
public:
    PaintBundle bundle;

    std::string name() const override { return "PAINT_VALUES"; }
    int opcode() const override { return 40; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override;
    bool isPaintOperation() const override { return true; }
    bool isVariableSupport() const override { return true; }
    void registerListening(RemoteContext& context) override {
        bundle.registerVars(context, this);
    }
    void updateVariables(RemoteContext& context) override {
        bundle.updateVariables(context);
    }

    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<PaintValues>();
        op->bundle.readBundle(buf);
        ops.push_back(std::move(op));
    }
};

// ── DrawRect (42) ─────────────────────────────────────────────────────
class DrawRect : public Operation {
public:
    float left = 0, top = 0, right = 0, bottom = 0;
    float oLeft = 0, oTop = 0, oRight = 0, oBottom = 0;

    std::string name() const override { return "DRAW_RECT"; }
    int opcode() const override { return 42; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override;
    bool isPaintOperation() const override { return true; }
    bool isVariableSupport() const override { return true; }
    void registerListening(RemoteContext& context) override;
    void updateVariables(RemoteContext& context) override;

    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<DrawRect>();
        op->left = buf.readNanId(); op->top = buf.readNanId();
        op->right = buf.readNanId(); op->bottom = buf.readNanId();
        op->oLeft = op->left; op->oTop = op->top;
        op->oRight = op->right; op->oBottom = op->bottom;
        ops.push_back(std::move(op));
    }
};

// ── DrawCircle (46) ───────────────────────────────────────────────────
class DrawCircle : public Operation {
public:
    float cx = 0, cy = 0, radius = 0;
    float oCx = 0, oCy = 0, oRadius = 0;

    std::string name() const override { return "DRAW_CIRCLE"; }
    int opcode() const override { return 46; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override;
    bool isPaintOperation() const override { return true; }
    bool isVariableSupport() const override { return true; }
    void registerListening(RemoteContext& context) override;
    void updateVariables(RemoteContext& context) override;

    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<DrawCircle>();
        op->cx = buf.readNanId(); op->cy = buf.readNanId();
        op->radius = buf.readNanId();
        op->oCx = op->cx; op->oCy = op->cy; op->oRadius = op->radius;
        ops.push_back(std::move(op));
    }
};

// ── DrawLine (47) ─────────────────────────────────────────────────────
class DrawLine : public Operation {
public:
    float x1 = 0, y1 = 0, x2 = 0, y2 = 0;
    float oX1 = 0, oY1 = 0, oX2 = 0, oY2 = 0;

    std::string name() const override { return "DRAW_LINE"; }
    int opcode() const override { return 47; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override;
    bool isPaintOperation() const override { return true; }
    bool isVariableSupport() const override { return true; }
    void registerListening(RemoteContext& context) override;
    void updateVariables(RemoteContext& context) override;

    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<DrawLine>();
        op->x1 = buf.readNanId(); op->y1 = buf.readNanId();
        op->x2 = buf.readNanId(); op->y2 = buf.readNanId();
        op->oX1 = op->x1; op->oY1 = op->y1;
        op->oX2 = op->x2; op->oY2 = op->y2;
        ops.push_back(std::move(op));
    }
};

// ── DrawOval (56) ─────────────────────────────────────────────────────
class DrawOval : public Operation {
public:
    float left = 0, top = 0, right = 0, bottom = 0;
    float oLeft = 0, oTop = 0, oRight = 0, oBottom = 0;

    std::string name() const override { return "DRAW_OVAL"; }
    int opcode() const override { return 56; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override;
    bool isPaintOperation() const override { return true; }
    bool isVariableSupport() const override { return true; }
    void registerListening(RemoteContext& context) override;
    void updateVariables(RemoteContext& context) override;

    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<DrawOval>();
        op->left = buf.readNanId(); op->top = buf.readNanId();
        op->right = buf.readNanId(); op->bottom = buf.readNanId();
        op->oLeft = op->left; op->oTop = op->top;
        op->oRight = op->right; op->oBottom = op->bottom;
        ops.push_back(std::move(op));
    }
};

// ── DrawRoundRect (51) ────────────────────────────────────────────────
class DrawRoundRect : public Operation {
public:
    float left = 0, top = 0, right = 0, bottom = 0;
    float radiusX = 0, radiusY = 0;
    float oLeft = 0, oTop = 0, oRight = 0, oBottom = 0;
    float oRadiusX = 0, oRadiusY = 0;

    std::string name() const override { return "DRAW_ROUND_RECT"; }
    int opcode() const override { return 51; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override;
    bool isPaintOperation() const override { return true; }
    bool isVariableSupport() const override { return true; }
    void registerListening(RemoteContext& context) override;
    void updateVariables(RemoteContext& context) override;

    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<DrawRoundRect>();
        op->left = buf.readNanId(); op->top = buf.readNanId();
        op->right = buf.readNanId(); op->bottom = buf.readNanId();
        op->radiusX = buf.readNanId(); op->radiusY = buf.readNanId();
        op->oLeft = op->left; op->oTop = op->top;
        op->oRight = op->right; op->oBottom = op->bottom;
        op->oRadiusX = op->radiusX; op->oRadiusY = op->radiusY;
        ops.push_back(std::move(op));
    }
};

// ── DrawSector (52) ───────────────────────────────────────────────────
class DrawSector : public Operation {
public:
    float left = 0, top = 0, right = 0, bottom = 0;
    float startAngle = 0, sweepAngle = 0;
    float oLeft = 0, oTop = 0, oRight = 0, oBottom = 0;
    float oStartAngle = 0, oSweepAngle = 0;

    std::string name() const override { return "DRAW_SECTOR"; }
    int opcode() const override { return 52; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override;
    bool isPaintOperation() const override { return true; }
    bool isVariableSupport() const override { return true; }
    void registerListening(RemoteContext& context) override;
    void updateVariables(RemoteContext& context) override;

    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<DrawSector>();
        op->left = buf.readNanId(); op->top = buf.readNanId();
        op->right = buf.readNanId(); op->bottom = buf.readNanId();
        op->startAngle = buf.readNanId(); op->sweepAngle = buf.readNanId();
        op->oLeft = op->left; op->oTop = op->top;
        op->oRight = op->right; op->oBottom = op->bottom;
        op->oStartAngle = op->startAngle; op->oSweepAngle = op->sweepAngle;
        ops.push_back(std::move(op));
    }
};

// ── DrawArc (152) ─────────────────────────────────────────────────────
class DrawArc : public Operation {
public:
    float left = 0, top = 0, right = 0, bottom = 0;
    float startAngle = 0, sweepAngle = 0;
    float oLeft = 0, oTop = 0, oRight = 0, oBottom = 0;
    float oStartAngle = 0, oSweepAngle = 0;

    std::string name() const override { return "DRAW_ARC"; }
    int opcode() const override { return 152; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override;
    bool isPaintOperation() const override { return true; }
    bool isVariableSupport() const override { return true; }
    void registerListening(RemoteContext& context) override;
    void updateVariables(RemoteContext& context) override;

    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<DrawArc>();
        op->left = buf.readNanId(); op->top = buf.readNanId();
        op->right = buf.readNanId(); op->bottom = buf.readNanId();
        op->startAngle = buf.readNanId(); op->sweepAngle = buf.readNanId();
        op->oLeft = op->left; op->oTop = op->top;
        op->oRight = op->right; op->oBottom = op->bottom;
        op->oStartAngle = op->startAngle; op->oSweepAngle = op->sweepAngle;
        ops.push_back(std::move(op));
    }
};

// ── DrawPath (124) ────────────────────────────────────────────────────
class DrawPath : public Operation {
public:
    int pathId = 0;

    std::string name() const override { return "DRAW_PATH"; }
    int opcode() const override { return 124; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override;
    bool isPaintOperation() const override { return true; }

    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<DrawPath>();
        op->pathId = buf.readId();
        ops.push_back(std::move(op));
    }
};

// ── DrawTweenPath (125) ───────────────────────────────────────────────
class DrawTweenPath : public Operation {
public:
    int path1Id = 0, path2Id = 0;
    float tween = 0, start = 0, stop = 0;
    float oTween = 0, oStart = 0, oStop = 0;

    std::string name() const override { return "DRAW_TWEEN_PATH"; }
    int opcode() const override { return 125; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override;
    bool isPaintOperation() const override { return true; }
    bool isVariableSupport() const override { return true; }
    void registerListening(RemoteContext& context) override;
    void updateVariables(RemoteContext& context) override;

    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<DrawTweenPath>();
        op->path1Id = buf.readId(); op->path2Id = buf.readId();
        op->tween = buf.readNanId(); op->start = buf.readNanId(); op->stop = buf.readNanId();
        op->oTween = op->tween; op->oStart = op->start; op->oStop = op->stop;
        ops.push_back(std::move(op));
    }
};

// ── DrawBitmap (44) ───────────────────────────────────────────────────
class DrawBitmap : public Operation {
public:
    int imageId = 0;
    float left = 0, top = 0, right = 0, bottom = 0;
    float oLeft = 0, oTop = 0, oRight = 0, oBottom = 0;
    int descriptionId = 0;

    std::string name() const override { return "DRAW_BITMAP"; }
    int opcode() const override { return 44; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override;
    bool isPaintOperation() const override { return true; }
    bool isVariableSupport() const override { return true; }
    void registerListening(RemoteContext& context) override;
    void updateVariables(RemoteContext& context) override;

    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<DrawBitmap>();
        op->imageId = buf.readId();
        op->left = buf.readNanId(); op->top = buf.readNanId();
        op->right = buf.readNanId(); op->bottom = buf.readNanId();
        op->oLeft = op->left; op->oTop = op->top;
        op->oRight = op->right; op->oBottom = op->bottom;
        op->descriptionId = buf.readId();
        ops.push_back(std::move(op));
    }
};

// ── DrawBitmapInt (66) ────────────────────────────────────────────────
class DrawBitmapInt : public Operation {
public:
    int imageId = 0;
    int srcL = 0, srcT = 0, srcR = 0, srcB = 0;
    int dstL = 0, dstT = 0, dstR = 0, dstB = 0;
    int cdId = 0;

    std::string name() const override { return "DRAW_BITMAP_INT"; }
    int opcode() const override { return 66; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override;
    bool isPaintOperation() const override { return true; }

    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<DrawBitmapInt>();
        op->imageId = buf.readId();
        op->srcL = buf.readInt(); op->srcT = buf.readInt();
        op->srcR = buf.readInt(); op->srcB = buf.readInt();
        op->dstL = buf.readInt(); op->dstT = buf.readInt();
        op->dstR = buf.readInt(); op->dstB = buf.readInt();
        op->cdId = buf.readId();
        ops.push_back(std::move(op));
    }
};

// ── DrawTextRun (43) ──────────────────────────────────────────────────
class DrawTextRun : public Operation {
public:
    int textId = 0, start = 0, end = 0, contextStart = 0, contextEnd = 0;
    float x = 0, y = 0;
    float oX = 0, oY = 0;
    bool rtl = false;

    std::string name() const override { return "DRAW_TEXT_RUN"; }
    int opcode() const override { return 43; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override;
    bool isPaintOperation() const override { return true; }
    bool isVariableSupport() const override { return true; }
    void registerListening(RemoteContext& context) override;
    void updateVariables(RemoteContext& context) override;

    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<DrawTextRun>();
        op->textId = buf.readId(); op->start = buf.readInt(); op->end = buf.readInt();
        op->contextStart = buf.readInt(); op->contextEnd = buf.readInt();
        op->x = buf.readNanId(); op->y = buf.readNanId();
        op->oX = op->x; op->oY = op->y;
        op->rtl = buf.readBoolean();
        ops.push_back(std::move(op));
    }
};

// ── DrawTextAnchored (133) ────────────────────────────────────────────
class DrawTextAnchored : public Operation {
public:
    int textId = 0;
    float x = 0, y = 0, panX = 0, panY = 0;
    float oX = 0, oY = 0, oPanX = 0, oPanY = 0;
    int flags = 0;

    std::string name() const override { return "DRAW_TEXT_ANCHOR"; }
    int opcode() const override { return 133; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override;
    bool isPaintOperation() const override { return true; }
    bool isVariableSupport() const override { return true; }
    void registerListening(RemoteContext& context) override;
    void updateVariables(RemoteContext& context) override;

    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<DrawTextAnchored>();
        op->textId = buf.readId();
        op->x = buf.readNanId(); op->y = buf.readNanId();
        op->panX = buf.readNanId(); op->panY = buf.readNanId();
        op->oX = op->x; op->oY = op->y;
        op->oPanX = op->panX; op->oPanY = op->panY;
        op->flags = buf.readInt();
        ops.push_back(std::move(op));
    }
};

// ── DrawTextOnPath (53) ───────────────────────────────────────────────
class DrawTextOnPath : public Operation {
public:
    int textId = 0, pathId = 0;
    float hOffset = 0, vOffset = 0;
    float oHOffset = 0, oVOffset = 0;

    std::string name() const override { return "DRAW_TEXT_ON_PATH"; }
    int opcode() const override { return 53; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override;
    bool isPaintOperation() const override { return true; }
    bool isVariableSupport() const override { return true; }
    void registerListening(RemoteContext& context) override;
    void updateVariables(RemoteContext& context) override;

    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<DrawTextOnPath>();
        op->textId = buf.readId(); op->pathId = buf.readId();
        // vOffset is written FIRST, ahead of hOffset — the reverse of the constructor
        // and of every signature in this family. Both the reference reader and the
        // TypeScript player read it in this order; reading h first silently swaps the
        // two, which shifts text across the path instead of along it.
        op->vOffset = buf.readNanId(); op->hOffset = buf.readNanId();
        op->oHOffset = op->hOffset; op->oVOffset = op->vOffset;
        ops.push_back(std::move(op));
    }
};

// ── ClipRect (39) ─────────────────────────────────────────────────────
class ClipRectOp : public Operation {
public:
    float left = 0, top = 0, right = 0, bottom = 0;
    float oLeft = 0, oTop = 0, oRight = 0, oBottom = 0;

    std::string name() const override { return "CLIP_RECT"; }
    int opcode() const override { return 39; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override;
    bool isPaintOperation() const override { return true; }
    bool isVariableSupport() const override { return true; }
    void registerListening(RemoteContext& context) override;
    void updateVariables(RemoteContext& context) override;

    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<ClipRectOp>();
        op->left = buf.readNanId(); op->top = buf.readNanId();
        op->right = buf.readNanId(); op->bottom = buf.readNanId();
        op->oLeft = op->left; op->oTop = op->top;
        op->oRight = op->right; op->oBottom = op->bottom;
        ops.push_back(std::move(op));
    }
};

// ── ClipPath (38) ─────────────────────────────────────────────────────
class ClipPathOp : public Operation {
public:
    int pathId = 0;

    std::string name() const override { return "CLIP_PATH"; }
    int opcode() const override { return 38; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override;
    bool isPaintOperation() const override { return true; }

    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<ClipPathOp>();
        int32_t pack = buf.readInt();
        // The low 20 bits are the path id (resolved inside a pattern), the top byte the region op.
        op->pathId = (pack & ~0xFFFFF) | (buf.remapId(pack & 0xFFFFF) & 0xFFFFF);
        ops.push_back(std::move(op));
    }
};

// ── Matrix operations ─────────────────────────────────────────────────
class MatrixSave : public Operation {
public:
    std::string name() const override { return "MATRIX_SAVE"; }
    int opcode() const override { return 130; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override;
    bool isPaintOperation() const override { return true; }
    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        ops.push_back(std::make_unique<MatrixSave>());
    }
};

class MatrixRestore : public Operation {
public:
    std::string name() const override { return "MATRIX_RESTORE"; }
    int opcode() const override { return 131; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override;
    bool isPaintOperation() const override { return true; }
    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        ops.push_back(std::make_unique<MatrixRestore>());
    }
};

class MatrixScale : public Operation {
public:
    float sx = 1, sy = 1, cx = 0, cy = 0;
    float oSx = 1, oSy = 1, oCx = 0, oCy = 0;

    std::string name() const override { return "MATRIX_SCALE"; }
    int opcode() const override { return 126; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override;
    bool isPaintOperation() const override { return true; }
    bool isVariableSupport() const override { return true; }
    void registerListening(RemoteContext& context) override;
    void updateVariables(RemoteContext& context) override;

    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<MatrixScale>();
        op->sx = buf.readNanId(); op->sy = buf.readNanId();
        op->cx = buf.readNanId(); op->cy = buf.readNanId();
        op->oSx = op->sx; op->oSy = op->sy;
        op->oCx = op->cx; op->oCy = op->cy;
        ops.push_back(std::move(op));
    }
};

class MatrixTranslate : public Operation {
public:
    float dx = 0, dy = 0;
    float oDx = 0, oDy = 0;

    std::string name() const override { return "MATRIX_TRANSLATE"; }
    int opcode() const override { return 127; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override;
    bool isPaintOperation() const override { return true; }
    bool isVariableSupport() const override { return true; }
    void registerListening(RemoteContext& context) override;
    void updateVariables(RemoteContext& context) override;

    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<MatrixTranslate>();
        op->dx = buf.readNanId(); op->dy = buf.readNanId();
        op->oDx = op->dx; op->oDy = op->dy;
        ops.push_back(std::move(op));
    }
};

class MatrixRotate : public Operation {
public:
    float angle = 0, cx = 0, cy = 0;
    float oAngle = 0, oCx = 0, oCy = 0;

    std::string name() const override { return "MATRIX_ROTATE"; }
    int opcode() const override { return 129; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override;
    bool isPaintOperation() const override { return true; }
    bool isVariableSupport() const override { return true; }
    void registerListening(RemoteContext& context) override;
    void updateVariables(RemoteContext& context) override;

    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<MatrixRotate>();
        op->angle = buf.readNanId(); op->cx = buf.readNanId(); op->cy = buf.readNanId();
        op->oAngle = op->angle; op->oCx = op->cx; op->oCy = op->cy;
        ops.push_back(std::move(op));
    }
};

class MatrixSkew : public Operation {
public:
    float sx = 0, sy = 0;
    float oSx = 0, oSy = 0;

    std::string name() const override { return "MATRIX_SKEW"; }
    int opcode() const override { return 128; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override;
    bool isPaintOperation() const override { return true; }
    bool isVariableSupport() const override { return true; }
    void registerListening(RemoteContext& context) override;
    void updateVariables(RemoteContext& context) override;

    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<MatrixSkew>();
        op->sx = buf.readNanId(); op->sy = buf.readNanId();
        op->oSx = op->sx; op->oSy = op->sy;
        ops.push_back(std::move(op));
    }
};

// ── Theme (63) ────────────────────────────────────────────────────────
class ThemeOp : public Operation {
public:
    int theme = 0;
    std::string name() const override { return "THEME"; }
    int opcode() const override { return 63; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override;
    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<ThemeOp>();
        op->theme = buf.readInt();
        ops.push_back(std::move(op));
    }
};

// ── RootContentDescription (103) ──────────────────────────────────────
class RootContentDescription : public Operation {
public:
    int contentDescriptionId = 0;
    std::string name() const override { return "ROOT_CONTENT_DESCRIPTION"; }
    int opcode() const override { return 103; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override {}
    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<RootContentDescription>();
        op->contentDescriptionId = buf.readId();
        ops.push_back(std::move(op));
    }
};

// ── FloatConstant (80) ────────────────────────────────────────────────
class FloatConstant : public Operation {
public:
    int id = 0;
    float value = 0;
    std::string name() const override { return "DATA_FLOAT"; }
    int opcode() const override { return 80; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override;
    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<FloatConstant>();
        op->id = buf.declareId(); op->value = buf.readNanId();
        ops.push_back(std::move(op));
    }
};

// ── IntegerConstant (140) ─────────────────────────────────────────────
class IntegerConstant : public Operation {
public:
    int id = 0;
    int value = 0;
    std::string name() const override { return "DATA_INT"; }
    int opcode() const override { return 140; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override;
    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<IntegerConstant>();
        op->id = buf.readInt(); op->value = buf.readInt();
        ops.push_back(std::move(op));
    }
};

// ── ColorConstant (138) ───────────────────────────────────────────────
class ColorConstant : public Operation {
public:
    int id = 0;
    int color = 0;
    std::string name() const override { return "COLOR_CONSTANT"; }
    int opcode() const override { return 138; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override;
    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<ColorConstant>();
        op->id = buf.declareId(); op->color = buf.readInt();
        ops.push_back(std::move(op));
    }
};

// ── ShaderData (45) ───────────────────────────────────────────────────
class ShaderData : public Operation {
public:
    int shaderID = 0;
    int shaderTextId = 0;

    struct FloatUniform { std::string name; std::vector<float> values; };
    struct IntUniform   { std::string name; std::vector<int> values; };
    struct BitmapUniform { std::string name; int bitmapId = 0; };

    std::vector<FloatUniform> floatUniforms;
    std::vector<IntUniform> intUniforms;
    std::vector<BitmapUniform> bitmapUniforms;

    std::string name() const override { return "SHADER_DATA"; }
    int opcode() const override { return 45; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override;
    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops);
};

// ── NamedVariable (137) ───────────────────────────────────────────────
class NamedVariable : public Operation {
public:
    int varId = 0, varType = 0;
    std::string varName;
    std::string name() const override { return "NAMED_VARIABLE"; }
    int opcode() const override { return 137; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override {
        if (varType == 2) {  // Color type
            context.registerNamedColor(varId, varName);
        }
    }
    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<NamedVariable>();
        op->varId = buf.declareId(); op->varType = buf.readInt();
        op->varName = buf.readUTF8();
        ops.push_back(std::move(op));
    }
};

// ── ClickArea (64) ────────────────────────────────────────────────────
class ClickArea : public Operation {
public:
    int id = 0, cdId = 0;
    float left = 0, top = 0, right = 0, bottom = 0;
    int metadataId = 0;
    // Resolved bounds
    float oLeft = 0, oTop = 0, oRight = 0, oBottom = 0;

    std::string name() const override { return "CLICK_AREA"; }
    int opcode() const override { return 64; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override;
    bool isVariableSupport() const override { return true; }
    void registerListening(RemoteContext& context) override;
    void updateVariables(RemoteContext& context) override;

    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<ClickArea>();
        op->id = buf.declareId(); op->cdId = buf.readId();
        op->left = buf.readNanId(); op->top = buf.readNanId();
        op->right = buf.readNanId(); op->bottom = buf.readNanId();
        op->metadataId = buf.readId();
        op->oLeft = op->left; op->oTop = op->top;
        op->oRight = op->right; op->oBottom = op->bottom;
        ops.push_back(std::move(op));
    }
};

// ── RootContentBehavior (65) ──────────────────────────────────────────
class RootContentBehavior : public Operation {
public:
    int scroll = 0, alignment = 0, sizing = 0, mode = 0;
    std::string name() const override { return "ROOT_CONTENT_BEHAVIOR"; }
    int opcode() const override { return 65; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override;
    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<RootContentBehavior>();
        op->scroll = buf.readInt(); op->alignment = buf.readInt();
        op->sizing = buf.readInt(); op->mode = buf.readInt();
        ops.push_back(std::move(op));
    }
};

// ── BooleanConstant (143) ─────────────────────────────────────────────
class BooleanConstant : public Operation {
public:
    int id = 0;
    bool value = false;
    std::string name() const override { return "DATA_BOOLEAN"; }
    int opcode() const override { return 143; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override;
    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<BooleanConstant>();
        op->id = buf.readInt(); op->value = buf.readBoolean();
        ops.push_back(std::move(op));
    }
};

// ── LongConstant (148) ────────────────────────────────────────────────
class LongConstant : public Operation {
public:
    int id = 0;
    int64_t value = 0;
    std::string name() const override { return "DATA_LONG"; }
    int opcode() const override { return 148; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override;
    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<LongConstant>();
        op->id = buf.readInt(); op->value = buf.readLong();
        ops.push_back(std::move(op));
    }
};

} // namespace rccore
