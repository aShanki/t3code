package expo.modules.t3devicekeys

import java.security.KeyPairGenerator
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class DeviceKeysTest {
  @Test
  fun joseSignaturesVerifyAfterConvertingBack() {
    val generator = KeyPairGenerator.getInstance("EC").apply { initialize(ECGenParameterSpec("secp256r1")) }
    repeat(50) {
      val pair = generator.generateKeyPair()
      val der = Signature.getInstance("SHA256withECDSA").run {
        initSign(pair.private)
        update("proof".toByteArray())
        sign()
      }
      val jose = DeviceKeys.derToJose(der)
      assertEquals(64, jose.size)
      val p1363 = Signature.getInstance("SHA256withECDSAinP1363Format").run {
        initVerify(pair.public)
        update("proof".toByteArray())
        verify(jose)
      }
      assertTrue(p1363)
    }
  }
}
