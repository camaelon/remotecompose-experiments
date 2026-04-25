#pragma once

struct GLFWwindow;

// Configure a GLFW window as a desktop-level widget (borderless, behind all
// normal windows, visible on all Spaces, hidden from Cmd-Tab).
// Call after glfwCreateWindow().
void configureDesktopWidget(GLFWwindow* window, int posX, int posY);
