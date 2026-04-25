#import <Cocoa/Cocoa.h>

#define GLFW_EXPOSE_NATIVE_COCOA
#include <GLFW/glfw3.h>
#include <GLFW/glfw3native.h>

#include "WidgetHelper.h"

void configureDesktopWidget(GLFWwindow* window, int posX, int posY) {
    NSWindow* nsWindow = (NSWindow*)glfwGetCocoaWindow(window);
    if (!nsWindow) return;

    // Place on the desktop layer — above wallpaper, below everything else
    [nsWindow setLevel:kCGDesktopWindowLevel];

    // Visible on all Spaces, stationary during Mission Control, hidden from Cmd-Tab
    [nsWindow setCollectionBehavior:
        NSWindowCollectionBehaviorCanJoinAllSpaces |
        NSWindowCollectionBehaviorStationary |
        NSWindowCollectionBehaviorIgnoresCycle];

    // Stay visible when the app loses focus
    [nsWindow setHidesOnDeactivate:NO];

    // Transparent window background (lets Skia alpha show through)
    [nsWindow setOpaque:NO];
    [nsWindow setBackgroundColor:[NSColor clearColor]];

    // Position on screen (Cocoa origin is bottom-left)
    [nsWindow setFrameOrigin:NSMakePoint(posX, posY)];
}
