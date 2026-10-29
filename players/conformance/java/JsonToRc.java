// The Java reference converter: androidx's RemoteComposeJsonParser, JSON in, .rc out.
//   java JsonToRc DOC.json OUT.rc
import java.nio.ByteBuffer;
import java.nio.file.Files;
import java.nio.file.Paths;

public class JsonToRc {
    public static void main(String[] args) throws Exception {
        String json = new String(Files.readAllBytes(Paths.get(args[0])), "UTF-8");
        ByteBuffer b = androidx.compose.remote.creation.json.RemoteComposeJsonParser.parseToByteBuffer(json);
        byte[] out = new byte[b.remaining()];
        b.get(out);
        Files.write(Paths.get(args[1]), out);
        System.err.println("wrote " + out.length);
    }
}
