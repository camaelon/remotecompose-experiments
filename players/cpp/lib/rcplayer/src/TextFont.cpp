#include "rcplayer/TextFont.h"

#include "include/core/SkFontMgr.h"
#include "include/core/SkTypeface.h"
#if defined(__APPLE__)
#include "include/ports/SkFontMgr_mac_ct.h"
#else
#include "include/ports/SkFontMgr_fontconfig.h"
#include "include/ports/SkFontScanner_FreeType.h"
#endif

namespace rcplayer {

SkFont systemTextFont(float size) {
    static sk_sp<SkFontMgr> mgr =
#if defined(__APPLE__)
        SkFontMgr_New_CoreText(nullptr);
#else
        SkFontMgr_New_FontConfig(nullptr, SkFontScanner_Make_FreeType());
#endif
    static sk_sp<SkTypeface> tf = mgr ? mgr->matchFamilyStyle(nullptr, SkFontStyle()) : nullptr;
    SkFont f(tf, size);
    f.setEdging(SkFont::Edging::kAntiAlias);
    f.setSubpixel(true);
    return f;
}

}  // namespace rcplayer
