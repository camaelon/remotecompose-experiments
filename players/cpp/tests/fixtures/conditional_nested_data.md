# conditional_nested_data

A regression repro for `ConditionalOp::apply` skipping nested ops outside the PAINT pass.

The document's only draw depends on data *defined inside* the conditional branch: a variable
`cy` used as the text's y coordinate. The writer puts a definition wherever the value is first
used, so for a value referenced only inside a branch the definition lands inside the branch.
If nested ops do not run in the data pass, the id is never populated.

It fails by drawing in the wrong place, not by drawing nothing, which is why it went unnoticed:

    rc2image conditional_nested_data.rc out.png --time 0

| | lit pixels | rows |
| :--- | ---: | :--- |
| before the fix | 475 | 0–10 — `@cy` resolved to 0, text clipped at the canvas top |
| after | 998 | 49–70 — centred on y=60, as the document asks |

Columns are 55–145 in both: same text, same size, wrong position. A test asserting "something
was drawn" passes either way.
