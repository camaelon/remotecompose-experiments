#include "rcplayer/Callbacks.h"

#include "rcplayer/Player.h"

#define GL_SILENCE_DEPRECATION
#include <GLFW/glfw3.h>

#include "include/core/SkStream.h"
#include "include/core/SkSurface.h"
#include "include/encode/SkPngEncoder.h"

#include <iostream>

namespace rcplayer {

void keyCallback(GLFWwindow* window, int key, int /*scancode*/, int action, int /*mods*/) {
    if (action != GLFW_PRESS) return;

    switch (key) {
        case GLFW_KEY_ESCAPE:
        case GLFW_KEY_Q:
            glfwSetWindowShouldClose(window, GLFW_TRUE);
            break;
        case GLFW_KEY_RIGHT:
            g.currentIndex++;
            g.timeSinceSwitch = 0.0;
            loadCurrentFile();
            break;
        case GLFW_KEY_LEFT:
            g.currentIndex--;
            g.timeSinceSwitch = 0.0;
            loadCurrentFile();
            break;
        case GLFW_KEY_SPACE:
            g.paused = !g.paused;
            if (g.avfPlayer) g.avfPlayer->setPaused(g.paused);
            g.videoHost.setPaused(g.paused);
            std::cerr << (g.paused ? "Paused" : "Playing") << "\n";
            break;
        case GLFW_KEY_R:
            loadCurrentFile();
            break;
        case GLFW_KEY_D:
            g.debug = (g.debug + 1) % 3;
            g.needsRedraw = true;
            std::cerr << "Debug: " << g.debug << "\n";
            break;
        case GLFW_KEY_S: {
            SkSurface* surf = g.backend ? g.backend->surface() : nullptr;
            if (surf) {
                auto image = surf->makeImageSnapshot();
                if (image) {
                    auto data = SkPngEncoder::Encode(nullptr, image.get(), {});
                    if (data) {
                        SkFILEWStream stream("/tmp/viewer_screenshot.png");
                        if (stream.isValid()) {
                            stream.write(data->data(), data->size());
                            std::cerr << "Saved /tmp/viewer_screenshot.png ("
                                      << g.width << "x" << g.height << ")\n";
                        }
                    }
                }
            }
            break;
        }
    }
}

// How far back the release-velocity baseline is kept. Long enough that a real flick
// registers, short enough that stopping before release still reads as a stop.
static constexpr double kVelocityWindow = 0.03;

void cursorCallback(GLFWwindow* /*window*/, double x, double y) {
    g.mouseX = static_cast<float>(x);
    g.mouseY = static_cast<float>(y);

    // A drag that began on an embedded rc-document goes to that sub-document, not the host.
    if (g.mouseDown && g.rcDocHost.isCapturing()) {
        g.rcDocHost.pointerMove(g.mouseX, g.mouseY);
        g.needsRedraw = true;
        return;
    }

    if (g.mouseDown && g.doc && g.context) {
        float tx = touchX(g.mouseX), ty = touchY(g.mouseY);
        g.context->loadFloat(rccore::RemoteContext::ID_TOUCH_POS_X, tx);
        g.context->loadFloat(rccore::RemoteContext::ID_TOUCH_POS_Y, ty);
        g.doc->touchDrag(*g.context, tx, ty);

        // Roll the samples forward only once the newest is old enough to be a useful
        // baseline. That keeps prev* between kVelocityWindow and 2x that behind the cursor,
        // so the release below always divides by a sane interval instead of by whatever
        // fraction of a millisecond separated the last two events.
        double now = glfwGetTime();
        if (now - g.lastMouseTime >= kVelocityWindow) {
            g.prevMouseX = g.lastMouseX;
            g.prevMouseY = g.lastMouseY;
            g.prevMouseTime = g.lastMouseTime;
            g.lastMouseX = g.mouseX;
            g.lastMouseY = g.mouseY;
            g.lastMouseTime = now;
        }
    }

    g.needsRedraw = true;
}

void mouseButtonCallback(GLFWwindow* /*window*/, int button, int action, int /*mods*/) {
    if (button == GLFW_MOUSE_BUTTON_LEFT) {
        if (action == GLFW_PRESS) {
            g.mouseDown = true;
            g.lastMouseX = g.prevMouseX = g.mouseX;
            g.lastMouseY = g.prevMouseY = g.mouseY;
            g.lastMouseTime = g.prevMouseTime = glfwGetTime();

            // If the press lands on an embedded rc-document, it captures the drag; the host
            // document doesn't also get it. Otherwise fall through to the host document.
            if (!g.rcDocHost.pointerDown(g.mouseX, g.mouseY) && g.doc && g.context) {
                g.doc->touchDown(*g.context, touchX(g.mouseX), touchY(g.mouseY));
            }
        } else if (action == GLFW_RELEASE) {
            g.mouseDown = false;

            // Measure against the *older* sample. TouchExpression turns this velocity into
            // the fling: a zero here makes getStopPosition return the current value, which
            // makes the easing curve zero-length, which looks exactly like the fling being
            // unimplemented. It is in pixels per second, matching what the platform reports.
            double now = glfwGetTime();
            double dt = now - g.prevMouseTime;
            float dx = 0, dy = 0;
            if (dt > 0.0001) {
                dx = static_cast<float>((g.mouseX - g.prevMouseX) / dt);
                dy = static_cast<float>((g.mouseY - g.prevMouseY) / dt);
            }
            if (g.rcDocHost.isCapturing()) {
                g.rcDocHost.pointerUp(g.mouseX, g.mouseY, dx, dy);
            } else if (g.doc && g.context) {
                g.doc->touchUp(*g.context, touchX(g.mouseX), touchY(g.mouseY), dx, dy);
                g.doc->onClick(*g.context, g.mouseX, g.mouseY);
            }
        }
        g.needsRedraw = true;
    }
}

void framebufferSizeCallback(GLFWwindow* /*window*/, int w, int h) {
    if (g.backend) g.backend->onFramebufferResize(w, h);
}

void windowSizeCallback(GLFWwindow* /*window*/, int w, int h) {
    ensureSurface(w, h);
    g.needsRedraw = true;
}

void installDefaultCallbacks(GLFWwindow* window) {
    glfwSetKeyCallback(window, keyCallback);
    glfwSetCursorPosCallback(window, cursorCallback);
    glfwSetMouseButtonCallback(window, mouseButtonCallback);
    glfwSetFramebufferSizeCallback(window, framebufferSizeCallback);
    glfwSetWindowSizeCallback(window, windowSizeCallback);
}

}  // namespace rcplayer
