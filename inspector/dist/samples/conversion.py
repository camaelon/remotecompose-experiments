#!/usr/bin/python3
with open("input.txt", "r", encoding="utf-8") as f:
    text_data = f.read()

binary_data = bytes(text_data, "utf-8").decode("unicode_escape").encode("latin-1")

with open("output.bin", "wb") as f:
    f.write(binary_data)
