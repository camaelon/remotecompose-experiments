// Browser entry for the JSON -> RC converter, so a page can compile a document with no
// toolchain at all. `convert` takes JSON text and returns the wire bytes.
export { convert } from './json2rc/Parser';
