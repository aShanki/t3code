package expo.modules.t3devicekeys

import java.net.URL
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RajeshUpdateTest {
  @Test fun downloadsOnlyFromTheForkAndGitHubHosts() {
    assertEquals(
      "https://github.com/aShanki/t3code/releases/download/rajesh-chat-v3/rajesh-chat-arm64.apk",
      RajeshUpdate.releaseUrl(3),
    )
    assertTrue(RajeshUpdate.validDownloadHost(URL(RajeshUpdate.releaseUrl(3))))
    assertTrue(RajeshUpdate.validDownloadHost(URL("https://release-assets.githubusercontent.com/file?sig=1")))
    assertFalse(RajeshUpdate.validDownloadHost(URL("http://github.com/file")))
    assertFalse(RajeshUpdate.validDownloadHost(URL("https://github.com.evil.example/file")))
    assertFalse(RajeshUpdate.validDownloadHost(URL("https://evilgithubusercontent.com/file")))
    assertFalse(RajeshUpdate.validDownloadHost(URL("https://github.com:444/file")))
    assertFalse(RajeshUpdate.validDownloadHost(URL("https://user@github.com/file")))
  }
}
