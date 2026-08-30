// macOS interactive web overlay: a WKWebView added on top of the GLFW window's content
// view, so a presentation can bring up a live URL and let the presenter click / scroll /
// type in the real page. Escape or the on-screen ✕ closes it.

#define GLFW_EXPOSE_NATIVE_COCOA
#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>
#include <GLFW/glfw3.h>
#include <GLFW/glfw3native.h>

#include "WebOverlay.h"

static WKWebView* gWebView = nil;
static NSButton*  gCloseButton = nil;
static id         gKeyMonitor = nil;
static NSWindow*  gHostWindow = nil;

// Target object for the close button's action.
@interface RCWebOverlayCloser : NSObject
- (void)onClose:(id)sender;
@end
@implementation RCWebOverlayCloser
- (void)onClose:(id)sender { (void)sender; webOverlayClose(); }
@end
static RCWebOverlayCloser* gCloser = nil;

// UI delegate so the page can drive native UI: file-open panels (HTML
// <input type="file">) and JavaScript alert/confirm/prompt dialogs. Without this a
// file button silently does nothing.
@interface RCWebUIDelegate : NSObject <WKUIDelegate>
@end
@implementation RCWebUIDelegate

- (void)webView:(WKWebView *)webView
    runOpenPanelWithParameters:(WKOpenPanelParameters *)parameters
              initiatedByFrame:(WKFrameInfo *)frame
             completionHandler:(void (^)(NSArray<NSURL *> *))completionHandler {
    (void)frame;
    NSOpenPanel* panel = [NSOpenPanel openPanel];
    panel.canChooseFiles = YES;
    panel.canChooseDirectories = parameters.allowsDirectories;
    panel.allowsMultipleSelection = parameters.allowsMultipleSelection;
    NSWindow* host = webView.window;
    void (^done)(NSModalResponse) = ^(NSModalResponse result) {
        completionHandler(result == NSModalResponseOK ? panel.URLs : nil);
    };
    if (host) [panel beginSheetModalForWindow:host completionHandler:done];
    else      [panel beginWithCompletionHandler:done];
}

- (void)webView:(WKWebView *)webView
    runJavaScriptAlertPanelWithMessage:(NSString *)message
                      initiatedByFrame:(WKFrameInfo *)frame
                     completionHandler:(void (^)(void))completionHandler {
    (void)webView; (void)frame;
    NSAlert* a = [[NSAlert alloc] init];
    a.messageText = message ?: @"";
    [a addButtonWithTitle:@"OK"];
    [a runModal];
    completionHandler();
}

- (void)webView:(WKWebView *)webView
    runJavaScriptConfirmPanelWithMessage:(NSString *)message
                        initiatedByFrame:(WKFrameInfo *)frame
                       completionHandler:(void (^)(BOOL))completionHandler {
    (void)webView; (void)frame;
    NSAlert* a = [[NSAlert alloc] init];
    a.messageText = message ?: @"";
    [a addButtonWithTitle:@"OK"];
    [a addButtonWithTitle:@"Cancel"];
    completionHandler([a runModal] == NSAlertFirstButtonReturn);
}
@end
static RCWebUIDelegate* gUIDelegate = nil;

bool webOverlayIsOpen() { return gWebView != nil; }

void webOverlayClose() {
    if (gKeyMonitor) { [NSEvent removeMonitor:gKeyMonitor]; gKeyMonitor = nil; }
    if (gCloseButton) { [gCloseButton removeFromSuperview]; gCloseButton = nil; }
    if (gWebView) { gWebView.UIDelegate = nil; [gWebView removeFromSuperview]; gWebView = nil; }
    gCloser = nil;
    gUIDelegate = nil;
    // The web view had first-responder status; hand keyboard focus back to the GLFW
    // content view so arrow keys / shortcuts reach the viewer again.
    if (gHostWindow) {
        [gHostWindow makeFirstResponder:gHostWindow.contentView];
        [gHostWindow makeKeyAndOrderFront:nil];
        gHostWindow = nil;
    }
}

bool webOverlayShow(GLFWwindow* window, const char* url) {
    if (!window || !url || !*url) return false;
    NSWindow* nsWindow = (NSWindow*)glfwGetCocoaWindow(window);
    if (!nsWindow) return false;
    NSView* content = [nsWindow contentView];
    if (!content) return false;
    gHostWindow = nsWindow;              // remembered so close() can restore key focus

    NSString* u = [NSString stringWithUTF8String:url];
    NSURL* nsurl = [NSURL URLWithString:u];
    if (!nsurl) return false;

    if (!gWebView) {
        WKWebViewConfiguration* cfg = [[WKWebViewConfiguration alloc] init];
        gWebView = [[WKWebView alloc] initWithFrame:content.bounds configuration:cfg];
        gWebView.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
        if (!gUIDelegate) gUIDelegate = [[RCWebUIDelegate alloc] init];
        gWebView.UIDelegate = gUIDelegate;      // enables file-open + JS dialogs
    }
    [gWebView setFrame:content.bounds];
    [content addSubview:gWebView positioned:NSWindowAbove relativeTo:nil];
    [gWebView loadRequest:[NSURLRequest requestWithURL:nsurl]];

    // On-screen close affordance (top-right).
    if (!gCloser) gCloser = [[RCWebOverlayCloser alloc] init];
    if (!gCloseButton) {
        gCloseButton = [[NSButton alloc] initWithFrame:NSMakeRect(0, 0, 44, 28)];
        [gCloseButton setBezelStyle:NSBezelStyleRounded];
        [gCloseButton setTitle:@"✕"];
        [gCloseButton setTarget:gCloser];
        [gCloseButton setAction:@selector(onClose:)];
    }
    NSRect b = content.bounds;
    [gCloseButton setFrame:NSMakeRect(b.size.width - 56, b.size.height - 40, 44, 28)];
    [gCloseButton setAutoresizingMask:NSViewMinXMargin | NSViewMinYMargin];
    [content addSubview:gCloseButton positioned:NSWindowAbove relativeTo:gWebView];

    [nsWindow makeFirstResponder:gWebView];

    // Escape closes the overlay regardless of what has focus.
    if (!gKeyMonitor) {
        gKeyMonitor = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskKeyDown
                                                            handler:^NSEvent*(NSEvent* e) {
            if (e.keyCode == 53 /* Escape */) { webOverlayClose(); return nil; }
            return e;
        }];
    }
    return true;
}

void webOverlayToggle(GLFWwindow* window, const char* url) {
    if (webOverlayIsOpen()) webOverlayClose();
    else webOverlayShow(window, url);
}
