/*
 * Copyright (C) 2024 The Android Open Source Project
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
package androidx.compose.remote.core.operations;

import static androidx.compose.remote.core.documentation.DocumentedOperation.INT_ARRAY;

import androidx.annotation.RestrictTo;
import androidx.compose.remote.core.Operation;
import androidx.compose.remote.core.Operations;
import androidx.compose.remote.core.PaintContext;
import androidx.compose.remote.core.PaintOperation;
import androidx.compose.remote.core.RemoteContext;
import androidx.compose.remote.core.VariableProvider;
import androidx.compose.remote.core.VariableSupport;
import androidx.compose.remote.core.WireBuffer;
import androidx.compose.remote.core.documentation.DocumentationBuilder;
import androidx.compose.remote.core.operations.macros.RemapContext;
import androidx.compose.remote.core.operations.paint.PaintBundle;
import androidx.compose.remote.core.serialize.MapSerializer;
import androidx.compose.remote.core.serialize.Serializable;

import org.jspecify.annotations.NonNull;

import java.util.List;

/** Paint data operation */
@RestrictTo(RestrictTo.Scope.LIBRARY_GROUP)
public class PaintData extends PaintOperation
        implements ComponentData, VariableSupport, VariableProvider, Serializable {
    private static final int OP_CODE = Operations.PAINT_VALUES;
    private static final String CLASS_NAME = "PaintData";
    @NonNull public PaintBundle mPaintData = new PaintBundle();

    public PaintData() {}

    public PaintData(@NonNull PaintBundle paintData) {
        mPaintData = paintData;
    }

    /**
     * Get the id of the paint data
     *
     * @return -1 as paint data has no id
     */
    @Override
    public int getId() {
        return -1;
    }

    /**
     * Set the id of the paint data
     *
     * @param id the new id (ignored)
     */
    @Override
    public void setId(int id) {
        // ignored
    }

    @Override
    public void updateVariables(@NonNull RemoteContext context) {
        // Local desktop-player fork: guarded against upstream PaintBundle walkers
        // that can ArrayIndexOutOfBoundsException on PATH_EFFECT subtypes the
        // current remote-core version doesn't recognise (PaintPathEffects.getIds
        // returns -1, which cascades into a negative array index). Skipping the
        // update leaves the paint at its current values rather than killing the
        // whole document.
        try {
            mPaintData.updateVariables(context);
        } catch (RuntimeException e) {
            // Swallow; see note above.
        }
    }

    @Override
    public void registerListening(@NonNull RemoteContext context) {
        // Local desktop-player fork: see note on updateVariables above. If the
        // bundle can't be walked we simply don't register its listeners, which
        // means a variable change inside this paint won't trigger a repaint for
        // it -- but the rest of the document loads.
        try {
            mPaintData.registerVars(context, this);
        } catch (RuntimeException e) {
            // Swallow; see note above.
        }
    }

    @Override
    public void write(@NonNull WireBuffer buffer) {
        apply(buffer, mPaintData);
    }

    @Override
    public String toString() {
        return "PaintData " + "\"" + mPaintData + "\"";
    }

    /**
     * The name of the class
     *
     * @return the name
     */
    @NonNull
    public static String name() {
        return CLASS_NAME;
    }

    /**
     * The OP_CODE for this command
     *
     * @return the opcode
     */
    public static int id() {
        return OP_CODE;
    }

    /**
     * add a paint data to the buffer
     *
     * @param buffer the buffer to add to
     * @param paintBundle the paint bundle
     */
    public static void apply(@NonNull WireBuffer buffer, @NonNull PaintBundle paintBundle) {
        buffer.start(Operations.PAINT_VALUES);
        paintBundle.writeBundle(buffer);
    }

    /**
     * Read this operation and add it to the list of operations
     *
     * @param buffer the buffer to read
     * @param operations the list of operations that will be added to
     * @param ctx mapping context for remapping IDs
     */
    public static void read(
            @NonNull WireBuffer buffer,
            @NonNull List<Operation> operations,
            @NonNull RemapContext ctx) {
        PaintData data = new PaintData();
        data.mPaintData.readBundle(buffer, ctx);
        operations.add(data);
    }

    /**
     * Populate the documentation with a description of this operation
     *
     * @param doc to append the description to.
     */
    public static void documentation(@NonNull DocumentationBuilder doc) {
        doc.operation("Paint & Styles Operations", OP_CODE, CLASS_NAME)
                .additionalDocumentation("paint_data")
                .description("Encode a Paint object with various properties")
                .field(INT_ARRAY, "paintBundle", "The encoded paint properties");
    }

    @Override
    public @NonNull String deepToString(@NonNull String indent) {
        return indent + toString();
    }

    @Override
    public void paint(@NonNull PaintContext context) {
        context.applyPaint(mPaintData);
    }

    @Override
    public void serialize(@NonNull MapSerializer serializer) {
        serializer.addType(CLASS_NAME).add("paintBundle", mPaintData);
    }
}
