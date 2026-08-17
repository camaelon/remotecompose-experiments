/*
 * Does the real VectorExpression.updateVariables preserve the vector opcodes?
 *
 * VectorOpCodes.isVectorOp documents that OFFSET+100.. live above the scalar op range and that
 * "callers that classify tokens as operator-vs-variable must treat these as operators too".
 * VectorExpression.updateVariables classifies with AnimatedFloatExpression.isMathOperator only.
 */
import androidx.compose.remote.core.RemoteContext;
import androidx.compose.remote.core.operations.VectorExpression;
import androidx.compose.remote.core.operations.utilities.AnimatedFloatExpression;
import androidx.compose.remote.core.operations.utilities.VectorOpCodes;

public final class VecOpCheck {
    public static void main(String[] a) {
        float vec3 = VectorOpCodes.VBUILD3;
        float norm = op(VectorOpCodes.OP_VNORM);
        System.out.println("isMathOperator(vec3)      = "
                + AnimatedFloatExpression.isMathOperator(vec3));
        System.out.println("isMathOperator(normalize) = "
                + AnimatedFloatExpression.isMathOperator(norm));
        System.out.println("isVectorOp(vec3)          = " + VectorOpCodes.isVectorOp(vec3));

        // program: 3 4 0 vec3  -> should build (3,4,0)
        float[] prog = {3f, 4f, 0f, vec3};
        VectorExpression op = new VectorExpression(100, 3, 0, prog);
        RemoteContext ctx = new OracleBridge.Ctx();
        System.out.println("before updateVariables: preCalc[3] isNaN = "
                + Float.isNaN(op.mPreCalc[3]));
        op.updateVariables(ctx);
        System.out.println("after  updateVariables: preCalc[3] isNaN = "
                + Float.isNaN(op.mPreCalc[3]) + "  value = " + op.mPreCalc[3]);
    }

    private static float op(int code) {
        return Float.intBitsToFloat(code | 0xFF800000);
    }
}
