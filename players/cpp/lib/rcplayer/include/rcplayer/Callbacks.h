// The viewer's default GLFW input handling, as callbacks a host app can install
// wholesale (installDefaultCallbacks) or wrap one at a time — a player with its own
// key bindings typically installs its own key callback and reuses the rest.
#pragma once

struct GLFWwindow;

namespace rcplayer {

// Left/Right step slides, Space pauses, R reloads, D cycles debug, S screenshots,
// Q/Esc closes the window.
void keyCallback(GLFWwindow* window, int key, int scancode, int action, int mods);

// Tracks the pointer and forwards drags to the document (or to an embedded
// sub-document that captured the press), keeping a delayed sample for fling velocity.
void cursorCallback(GLFWwindow* window, double x, double y);
void mouseButtonCallback(GLFWwindow* window, int button, int action, int mods);

void framebufferSizeCallback(GLFWwindow* window, int w, int h);
void windowSizeCallback(GLFWwindow* window, int w, int h);

// Install all five on `window`.
void installDefaultCallbacks(GLFWwindow* window);

}  // namespace rcplayer
