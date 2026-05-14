#include "WidgetHelper.h"

void configureDesktopWidget(GLFWwindow* /*window*/, int /*posX*/, int /*posY*/) {
    // Linux widget integration is intentionally a no-op for now. GLFW still
    // applies the cross-platform borderless/transparency hints from main.cpp.
}
