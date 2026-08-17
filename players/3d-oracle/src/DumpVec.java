/*
 * Run a VectorRpn program through the *real* remote-core evaluator and print the result as raw
 * float bits, so a port can be compared value by value rather than by pixel. VectorExpression
 * writes to variables rather than drawing, so an image diff would not see it at all.
 *
 *   java -cp classes DumpVec "<token> <token> ..."           # exact domain
 *   java -cp classes DumpVec --soft "<token> ..."            # soft-domain denominators
 */
import androidx.compose.remote.core.operations.utilities.VectorOpCodes;
import androidx.compose.remote.core.operations.utilities.VectorRpn;

public final class DumpVec {
    public static void main(String[] args) {
        boolean soft = args.length > 0 && args[0].equals("--soft");
        String prog = args[soft ? 1 : 0];
        String[] tok = prog.trim().split("\\s+");
        float[] p = new float[tok.length];
        for (int i = 0; i < tok.length; i++) {
            p[i] = token(tok[i]);
        }
        VectorRpn rpn = new VectorRpn();
        rpn.mSoftDomain = soft;
        float[] out = new float[VectorRpn.MAX_DIM];
        int lanes = rpn.apply(p, p.length, out);
        StringBuilder sb = new StringBuilder();
        sb.append(lanes);
        for (float v : out) {
            sb.append(' ').append(Float.floatToRawIntBits(v));
        }
        System.out.println(sb);
    }

    /** A token is a number, or an operator by name (a NaN payload, so it is looked up). */
    private static float token(String s) {
        switch (s) {
            case "+": return op(VectorOpCodes.OP_ADD);
            case "-": return op(VectorOpCodes.OP_SUB);
            case "*": return op(VectorOpCodes.OP_MUL);
            case "/": return op(VectorOpCodes.OP_DIV);
            case "%": return op(VectorOpCodes.OP_MOD);
            case "min": return op(VectorOpCodes.OP_MIN);
            case "max": return op(VectorOpCodes.OP_MAX);
            case "pow": return op(VectorOpCodes.OP_POW);
            case "sqrt": return op(VectorOpCodes.OP_SQRT);
            case "abs": return op(VectorOpCodes.OP_ABS);
            case "square": return op(VectorOpCodes.OP_SQUARE);
            case "sin": return op(VectorOpCodes.OP_SIN);
            case "cos": return op(VectorOpCodes.OP_COS);
            case "floor": return op(VectorOpCodes.OP_FLOOR);
            case "ceil": return op(VectorOpCodes.OP_CEIL);
            case "round": return op(VectorOpCodes.OP_ROUND);
            case "neg": return op(VectorOpCodes.OP_CHANGE_SIGN);
            case "inv": return op(VectorOpCodes.OP_INV);
            case "nop": return op(VectorOpCodes.OP_NOP);
            case "vec2": return op(VectorOpCodes.OP_VBUILD2);
            case "vec3": return op(VectorOpCodes.OP_VBUILD3);
            case "vec4": return op(VectorOpCodes.OP_VBUILD4);
            case "dot": return op(VectorOpCodes.OP_VDOT);
            case "cross": return op(VectorOpCodes.OP_VCROSS);
            case "len": return op(VectorOpCodes.OP_VLEN);
            case "lensq": return op(VectorOpCodes.OP_VLENSQ);
            case "norm": return op(VectorOpCodes.OP_VNORM);
            default: return Float.parseFloat(s);
        }
    }

    private static float op(int code) {
        return Float.intBitsToFloat(code | 0xFF800000);
    }
}
