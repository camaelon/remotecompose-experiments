// macOS implementation: each "web:<url>" custom component gets a WKWebView positioned
// over the slide at the component's on-screen bounds (derived from the Skia canvas
// matrix). The view is a real, interactive page that follows layout/transitions.

#define GLFW_EXPOSE_NATIVE_COCOA
#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>
#include <GLFW/glfw3.h>
#include <GLFW/glfw3native.h>

#include "WebCustomHost.h"
#include "rcskia/SkiaPaintContext.h"
#include "include/core/SkCanvas.h"
#include "include/core/SkMatrix.h"

#include <map>
#include <set>
#include <string>

// ── Native UI delegate: file-open panels + JS dialogs, so pages that load files work.
@interface RCWebHostUIDelegate : NSObject <WKUIDelegate>
@end
@implementation RCWebHostUIDelegate
- (void)webView:(WKWebView *)webView
    runOpenPanelWithParameters:(WKOpenPanelParameters *)parameters
              initiatedByFrame:(WKFrameInfo *)frame
             completionHandler:(void (^)(NSArray<NSURL *> *))completionHandler {
    (void)frame;
    NSOpenPanel* panel = [NSOpenPanel openPanel];
    panel.canChooseFiles = YES;
    panel.canChooseDirectories = parameters.allowsDirectories;
    panel.allowsMultipleSelection = parameters.allowsMultipleSelection;
    void (^done)(NSModalResponse) = ^(NSModalResponse r) {
        completionHandler(r == NSModalResponseOK ? panel.URLs : nil);
    };
    NSWindow* host = webView.window;
    if (host) [panel beginSheetModalForWindow:host completionHandler:done];
    else      [panel beginWithCompletionHandler:done];
}
@end

// ── Host state (single instance; file-static keeps ObjC types out of the header) ──────
static GLFWwindow* gWindow = nullptr;
// Web views are keyed by URL, not component id: component ids are only unique within a
// single .rc, so keying by id would wrongly reuse a previous slide's page. Keying by URL
// gives each distinct page one warm, reusable view.
static std::map<std::string, WKWebView*> gViews;
static std::set<std::string> gSeenThisFrame;
static RCWebHostUIDelegate* gUIDelegate = nil;
static id gKeyMonitor = nil;

static NSView* hostContentView() {
    if (!gWindow) return nil;
    NSWindow* w = (NSWindow*)glfwGetCocoaWindow(gWindow);
    return w ? [w contentView] : nil;
}

void WebCustomHost::setWindow(GLFWwindow* window) { gWindow = window; }

void WebCustomHost::beginFrame() { gSeenThisFrame.clear(); }

void WebCustomHost::endFrame() {
    // Hide any web views not drawn this frame (not on the current slide).
    for (auto& [url, view] : gViews) {
        bool seen = gSeenThisFrame.count(url) != 0;
        if (view.hidden == seen) view.hidden = !seen;   // toggle only on change
    }
}

void WebCustomHost::reset() {
    for (auto& [url, view] : gViews) [view removeFromSuperview];
    gViews.clear();
    gSeenThisFrame.clear();
    if (gKeyMonitor) { [NSEvent removeMonitor:gKeyMonitor]; gKeyMonitor = nil; }
    gUIDelegate = nil;
}

bool WebCustomHost::drawCustom(int componentId, const std::string& config,
                               rccore::PaintContext* pc, float w, float h, double) {
    if (w <= 0 || h <= 0) return false;
    // config is "web:<url>".
    auto colon = config.find(':');
    if (colon == std::string::npos || config.compare(0, colon, "web") != 0) return false;
    std::string url = config.substr(colon + 1);
    if (url.empty()) return false;

    NSView* content = hostContentView();
    auto* skpc = static_cast<rcskia::SkiaPaintContext*>(pc);
    if (!content || !skpc || !skpc->canvas()) return false;

    // Map the component box (0,0)..(w,h) through the current canvas matrix. The Skia
    // surface is sized in window *points* (ensureSurface uses the window size, not the
    // framebuffer pixels), so the result is already in content-view coordinates — no
    // backing-scale division. Flip Y for a bottom-left-origin (non-flipped) NSView.
    SkMatrix m = skpc->canvas()->getTotalMatrix();
    SkRect dev;
    m.mapRect(&dev, SkRect::MakeWH(w, h));

    CGFloat yPt = content.isFlipped ? dev.top()
                                    : (content.bounds.size.height - dev.bottom());
    NSRect frame = NSMakeRect(dev.left(), yPt, dev.width(), dev.height());

    // One warm view per URL; created (and loaded once) lazily, then just repositioned.
    (void)componentId;
    WKWebView* view = nil;
    auto it = gViews.find(url);
    if (it == gViews.end()) {
        if (!gUIDelegate) gUIDelegate = [[RCWebHostUIDelegate alloc] init];
        view = [[WKWebView alloc] initWithFrame:frame];
        view.UIDelegate = gUIDelegate;
        [content addSubview:view];
        gViews[url] = view;
        NSURL* nsurl = [NSURL URLWithString:[NSString stringWithUTF8String:url.c_str()]];
        if (nsurl) [view loadRequest:[NSURLRequest requestWithURL:nsurl]];
        // Esc hands keyboard focus back to the GLFW view so slide navigation resumes
        // after interacting with a page.
        if (!gKeyMonitor) {
            gKeyMonitor = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskKeyDown
                                                                handler:^NSEvent*(NSEvent* e) {
                if (e.keyCode == 53 /* Esc */ && gWindow) {
                    NSWindow* nw = (NSWindow*)glfwGetCocoaWindow(gWindow);
                    // Only when a web view holds focus: release it back to the GLFW
                    // view and consume the Esc. Otherwise let it through (quit).
                    if (nw && nw.firstResponder != nw.contentView) {
                        [nw makeFirstResponder:nw.contentView];
                        return nil;
                    }
                }
                return e;
            }];
        }
    } else {
        view = it->second;
    }
    [view setFrame:frame];
    if (view.hidden) view.hidden = NO;
    gSeenThisFrame.insert(url);
    return true;
}
