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

// ── Host state ────────────────────────────────────────────────────────────────────────
static GLFWwindow* gWindow = nullptr;
// Keyed by URL, not component id (ids are only unique within a single .rc). Each entry
// is a *container* view (translucent-black backing) holding a transparent WKWebView and a
// spinner — so the loading state shows a dark box with a spinner, and transparent pages
// let the slide show through.
static std::map<std::string, NSView*> gViews;
static std::map<std::string, NSRect> gLastFrame;   // last applied frame per view
static std::set<std::string> gSeenThisFrame;
static NSView* gActiveContainer = nil;             // the web view the user clicked into
static id gKeyMonitor = nil;
static id gMouseMonitor = nil;

static NSView* hostContentView() {
    if (!gWindow) return nil;
    NSWindow* w = (NSWindow*)glfwGetCocoaWindow(gWindow);
    return w ? [w contentView] : nil;
}

// Hand keyboard focus back to the GLFW content view (so arrow keys navigate slides).
static void focusGLFWContentView() {
    if (!gWindow) return;
    NSWindow* nw = (NSWindow*)glfwGetCocoaWindow(gWindow);
    if (nw && nw.firstResponder != nw.contentView) [nw makeFirstResponder:nw.contentView];
}

static void deactivateWeb() {
    if (gActiveContainer) {
        gActiveContainer.layer.borderWidth = 0.0;
        gActiveContainer = nil;
    }
    focusGLFWContentView();
}

// The user clicked into a web page: focus it and draw a blue ring so it's clear the
// keyboard now goes to the page (Esc releases it).
static void activateWeb(NSView* container) {
    if (gActiveContainer == container) return;
    if (gActiveContainer) gActiveContainer.layer.borderWidth = 0.0;
    gActiveContainer = container;
    container.layer.borderColor = [[NSColor keyboardFocusIndicatorColor] CGColor];
    container.layer.borderWidth = 3.0;
    for (NSView* sub in container.subviews) {
        if ([sub isKindOfClass:[WKWebView class]]) {
            [container.window makeFirstResponder:sub];
            break;
        }
    }
}

static void ensureMonitors() {
    // Keyboard: when no page is focused, keep keys on the deck (defeats a page that
    // autofocuses an input on load); when a page is focused, Esc releases it.
    if (!gKeyMonitor) {
        gKeyMonitor = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskKeyDown
                                                            handler:^NSEvent*(NSEvent* e) {
            if (gActiveContainer != nil) {
                if (e.keyCode == 53 /* Esc */) { deactivateWeb(); return nil; }
                return e;
            }
            focusGLFWContentView();
            return e;
        }];
    }
    // Mouse: clicking a page focuses it; clicking elsewhere releases focus.
    if (!gMouseMonitor) {
        gMouseMonitor = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskLeftMouseDown
                                                              handler:^NSEvent*(NSEvent* e) {
            NSView* content = hostContentView();
            if (content) {
                NSPoint p = [content convertPoint:e.locationInWindow fromView:nil];
                NSView* hit = nil;
                for (auto& kv : gViews) {
                    NSView* c = kv.second;
                    if (!c.hidden && NSPointInRect(p, c.frame)) { hit = c; break; }
                }
                if (hit) activateWeb(hit); else deactivateWeb();
            }
            return e;   // let the click through to the page
        }];
    }
}

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

// ── Loading spinner shown over a page until it finishes loading ────────────────────────
static NSString* const kSpinnerId = @"rc-web-spinner";
static const CGFloat kSpinnerSize = 64.0;          // 2x the default regular spinner

static void addSpinner(NSView* container) {
    NSProgressIndicator* spin = [[NSProgressIndicator alloc] init];
    spin.style = NSProgressIndicatorStyleSpinning;
    spin.identifier = kSpinnerId;
    // A dark-aqua appearance renders the spinner light (white) instead of dark.
    spin.appearance = [NSAppearance appearanceNamed:NSAppearanceNameDarkAqua];
    NSRect b = container.bounds;
    spin.frame = NSMakeRect((b.size.width - kSpinnerSize) * 0.5,
                            (b.size.height - kSpinnerSize) * 0.5,
                            kSpinnerSize, kSpinnerSize);
    // Flexible margins on all sides keep it roughly centred as the view resizes.
    spin.autoresizingMask = NSViewMinXMargin | NSViewMaxXMargin |
                            NSViewMinYMargin | NSViewMaxYMargin;
    [spin startAnimation:nil];
    [container addSubview:spin];
}

// The spinner lives in the web view's container (its superview).
static void setSpinnerVisible(WKWebView* wv, bool visible) {
    NSView* container = wv.superview;
    for (NSView* sub in container.subviews) {
        if ([sub.identifier isEqualToString:kSpinnerId] &&
            [sub isKindOfClass:[NSProgressIndicator class]]) {
            NSProgressIndicator* p = (NSProgressIndicator*)sub;
            p.hidden = !visible;
            if (visible) [p startAnimation:nil]; else [p stopAnimation:nil];
            return;
        }
    }
}

// ── Navigation delegate: drive the spinner over the page's load lifecycle ──────────────
@interface RCWebNavDelegate : NSObject <WKNavigationDelegate>
@end
@implementation RCWebNavDelegate
- (void)webView:(WKWebView*)wv didStartProvisionalNavigation:(WKNavigation*)n {
    (void)n; setSpinnerVisible(wv, true);
}
- (void)webView:(WKWebView*)wv didFinishNavigation:(WKNavigation*)n {
    (void)n;
    setSpinnerVisible(wv, false);
    // A freshly-loaded page may autofocus an input and steal the keyboard. Unless the
    // user clicked into this page, keep focus on the deck so arrow keys still navigate.
    if (wv.superview != gActiveContainer) focusGLFWContentView();
}
- (void)webView:(WKWebView*)wv didFailNavigation:(WKNavigation*)n withError:(NSError*)e {
    (void)n; (void)e; setSpinnerVisible(wv, false);
}
- (void)webView:(WKWebView*)wv didFailProvisionalNavigation:(WKNavigation*)n withError:(NSError*)e {
    (void)n; (void)e; setSpinnerVisible(wv, false);
}
@end
static RCWebNavDelegate* gNavDelegate = nil;
static RCWebHostUIDelegate* gUIDelegate = nil;

void WebCustomHost::setWindow(GLFWwindow* window) { gWindow = window; }

void WebCustomHost::beginFrame() { gSeenThisFrame.clear(); }

void WebCustomHost::endFrame() {
    // Hide any web views not drawn this frame (not on the current slide).
    for (auto& [url, view] : gViews) {
        bool seen = gSeenThisFrame.count(url) != 0;
        if (view.hidden == seen) view.hidden = !seen;   // toggle only on change
    }
    // If the focused page left the slide, hand keyboard focus back to the deck.
    if (gActiveContainer && gActiveContainer.hidden) deactivateWeb();
}

void WebCustomHost::reset() {
    for (auto& [url, view] : gViews) [view removeFromSuperview];
    gViews.clear();
    gLastFrame.clear();
    gSeenThisFrame.clear();
    gActiveContainer = nil;
    if (gKeyMonitor) { [NSEvent removeMonitor:gKeyMonitor]; gKeyMonitor = nil; }
    if (gMouseMonitor) { [NSEvent removeMonitor:gMouseMonitor]; gMouseMonitor = nil; }
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
    // Snap to the backing-pixel grid, expanding outward so the view fully covers its box.
    // A fractional frame (fullscreen scale isn't integral) leaves the view's layer edge
    // anti-aliased against the dark slide — a hairline on the right/bottom edges.
    frame = [content backingAlignedRect:frame options:NSAlignAllEdgesOutward];

    // One warm container per URL; created (and loaded once) lazily, then repositioned.
    (void)componentId;
    NSView* view = nil;                  // the container (what we position / show / hide)
    auto it = gViews.find(url);
    if (it == gViews.end()) {
        if (!gUIDelegate) gUIDelegate = [[RCWebHostUIDelegate alloc] init];
        if (!gNavDelegate) gNavDelegate = [[RCWebNavDelegate alloc] init];

        // Container: a translucent-black backing so the loading state is a dark box (and
        // transparent pages let the slide show through), instead of the default white.
        NSView* container = [[NSView alloc] initWithFrame:frame];
        container.wantsLayer = YES;
        container.layer.backgroundColor = [[NSColor colorWithWhite:0.0 alpha:0.55] CGColor];
        container.hidden = YES;          // endFrame reveals it when it's on-screen
        [content addSubview:container];
        gViews[url] = container;

        // Transparent web view filling the container.
        WKWebView* wv = [[WKWebView alloc] initWithFrame:container.bounds];
        wv.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
        wv.UIDelegate = gUIDelegate;
        wv.navigationDelegate = gNavDelegate;
        @try { [wv setValue:@NO forKey:@"drawsBackground"]; } @catch (NSException* e) { (void)e; }
        [container addSubview:wv];
        addSpinner(container);           // spins over the dark box until the page loads

        view = container;
        ensureMonitors();                // click-to-focus + keep keys on the deck / Esc
        NSURL* nsurl = [NSURL URLWithString:[NSString stringWithUTF8String:url.c_str()]];
        if (nsurl && nsurl.isFileURL) {
            // Local HTML file: WKWebView blocks file access via a plain request, so load it
            // with read access granted to its directory (so linked CSS/JS/images load too).
            NSURL* dir = [nsurl URLByDeletingLastPathComponent];
            [wv loadFileURL:nsurl allowingReadAccessToURL:(dir ?: nsurl)];
        } else if (nsurl) {
            [wv loadRequest:[NSURLRequest requestWithURL:nsurl]];
        }
    } else {
        view = it->second;
    }
    // Only reposition when the box actually moved (a fraction of a point of tolerance).
    // Calling setFrame every frame forces WebKit to re-layout, which makes an otherwise
    // static page scroll/interact sluggishly on animated slides.
    auto lf = gLastFrame.find(url);
    if (lf == gLastFrame.end() || !NSEqualRects(lf->second, frame)) {
        [view setFrame:frame];
        gLastFrame[url] = frame;
    }

    // Mark "seen" (→ endFrame keeps it visible) only when the box is meaningfully
    // on-screen. A push transition bakes the outgoing slide's content into the current
    // document, so a previous slide's page sits off-screen (or peeks a sub-pixel sliver)
    // once settled — requiring real overlap keeps it hidden.
    NSRect inter = NSIntersectionRect(frame, content.bounds);
    if (inter.size.width > 2.0 && inter.size.height > 2.0) {
        gSeenThisFrame.insert(url);
    }
    return true;
}
