package com.hightechhub.crm.demo;
import android.content.Context;
import android.content.SharedPreferences;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class SessionVaultTest {
 @Test public void encryptedRoundTripSurvivesNewInstanceAndRemoves() throws Exception {
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
  SessionVault vault=new SessionVault(context,"secure-session-test");
  String plaintext="SYNTHETIC_SESSION_NOT_A_REAL_TOKEN";
  try {
   vault.set("session",plaintext);
   String first=context.getSharedPreferences("secure-session-test",Context.MODE_PRIVATE).getString("session",null);
   assertNotNull(first);assertFalse(first.contains(plaintext));
   assertEquals(plaintext,new SessionVault(context,"secure-session-test").get("session"));
   vault.set("session",plaintext);
   String second=context.getSharedPreferences("secure-session-test",Context.MODE_PRIVATE).getString("session",null);
   assertNotEquals(first,second); // Fresh randomized IV on every write.
   vault.remove("session");assertNull(vault.get("session"));
  } finally {vault.remove("session");}
 }
 @Test public void tamperedAndSwappedCiphertextIsCleared() throws Exception {
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
  SessionVault vault=new SessionVault(context,"secure-session-test");
  SharedPreferences prefs=context.getSharedPreferences("secure-session-test",Context.MODE_PRIVATE);
  try {
   vault.set("original","SYNTHETIC");
   prefs.edit().putString("different",prefs.getString("original",null)).commit();
   assertNull(vault.get("different"));assertFalse(prefs.contains("different"));
   prefs.edit().putString("original","broken").commit();
   assertNull(vault.get("original"));assertFalse(prefs.contains("original"));
  } finally {vault.remove("original");vault.remove("different");}
 }
}
