package expo.modules.t3devicekeys

import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.security.keystore.StrongBoxUnavailableException
import java.math.BigInteger
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.MessageDigest
import java.security.PrivateKey
import java.security.Signature
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec
import java.util.Base64

/**
 * A P-256 signing key held by Android Keystore. The private key never leaves it; JavaScript
 * only sees the public point, its RFC 7638 thumbprint and signatures.
 */
object DeviceKeys {
  private const val PROVIDER = "AndroidKeyStore"

  private fun store() = KeyStore.getInstance(PROVIDER).apply { load(null) }

  @Synchronized
  fun ensure(alias: String): Map<String, String> {
    val keyStore = store()
    if (!keyStore.containsAlias(alias)) generate(alias)
    val publicKey = keyStore.getCertificate(alias).publicKey as ECPublicKey
    val x = base64Url(fixed(publicKey.w.affineX))
    val y = base64Url(fixed(publicKey.w.affineY))
    val thumbprint = base64Url(
      MessageDigest.getInstance("SHA-256")
        .digest("{\"crv\":\"P-256\",\"kty\":\"EC\",\"x\":\"$x\",\"y\":\"$y\"}".toByteArray())
    )
    return mapOf("x" to x, "y" to y, "jkt" to thumbprint)
  }

  fun sign(alias: String, data: String): String {
    val key = store().getKey(alias, null) as? PrivateKey
      ?: throw IllegalStateException("No device key")
    val der = Signature.getInstance("SHA256withECDSA").run {
      initSign(key)
      update(data.toByteArray(Charsets.UTF_8))
      sign()
    }
    return base64Url(derToJose(der))
  }

  fun delete(alias: String) {
    val keyStore = store()
    if (keyStore.containsAlias(alias)) keyStore.deleteEntry(alias)
  }

  private fun generate(alias: String) {
    fun spec(strongBox: Boolean) = KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_SIGN)
      .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
      .setDigests(KeyProperties.DIGEST_SHA256)
      .apply { if (strongBox && Build.VERSION.SDK_INT >= 28) setIsStrongBoxBacked(true) }
      .build()
    val generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, PROVIDER)
    try {
      generator.initialize(spec(strongBox = true))
      generator.generateKeyPair()
    } catch (_: StrongBoxUnavailableException) {
      generator.initialize(spec(strongBox = false))
      generator.generateKeyPair()
    }
  }

  private fun base64Url(bytes: ByteArray) =
    Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)

  /** An unsigned 32-byte big-endian coordinate. */
  internal fun fixed(value: BigInteger): ByteArray {
    val raw = value.toByteArray().let { if (it.size > 32) it.copyOfRange(it.size - 32, it.size) else it }
    return ByteArray(32 - raw.size) + raw
  }

  /** ECDSA DER (SEQUENCE of two INTEGERs) to the JOSE form: r and s as 32 bytes each. */
  internal fun derToJose(der: ByteArray): ByteArray {
    var index = 2
    if (der[1].toInt() and 0x80 != 0) index += der[1].toInt() and 0x7f
    fun integer(): ByteArray {
      require(der[index].toInt() == 0x02) { "Not an ECDSA signature" }
      val length = der[index + 1].toInt()
      val value = der.copyOfRange(index + 2, index + 2 + length)
      index += 2 + length
      return fixed(BigInteger(1, value))
    }
    return integer() + integer()
  }
}
