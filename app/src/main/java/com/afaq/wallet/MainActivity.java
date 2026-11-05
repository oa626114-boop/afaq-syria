package com.afaq.wallet;

import android.app.Activity;
import android.app.AlertDialog;
import android.os.Bundle;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.view.Gravity;
import android.view.View;
import android.animation.ValueAnimator;
import android.view.animation.LinearInterpolator;
import android.widget.*;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

public class MainActivity extends Activity {
    private static final String API = "https://omax-api-105a.oa626114.workers.dev";
    private static final int NAVY = Color.rgb(21,54,75), DARK = Color.rgb(7,26,43);
    private static final int GOLD = Color.rgb(224,189,104), PALE = Color.rgb(246,239,214);
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private SharedPreferences prefs;
    private LinearLayout page;
    private String token = "";
    private ValueAnimator beeAnimator;

    @Override public void onCreate(Bundle b) {
        super.onCreate(b);
        getWindow().setStatusBarColor(NAVY);
        getWindow().setNavigationBarColor(DARK);
        prefs = getSharedPreferences("afaq_wallet_session", MODE_PRIVATE);
        token = readToken();
        if (token.isEmpty()) showLogin(); else loadAccount();
    }

    private int dp(float n) { return (int)(n * getResources().getDisplayMetrics().density + .5f); }
    private GradientDrawable bg(int color) {
        GradientDrawable d = new GradientDrawable(); d.setColor(color);
        d.setCornerRadius(dp(13)); d.setStroke(dp(1), 0xff8a7544); return d;
    }
    private TextView text(String s, int size, boolean bold) {
        TextView t = new TextView(this); t.setText(s); t.setTextColor(PALE); t.setTextSize(size);
        t.setGravity(Gravity.RIGHT); if (bold) t.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        return t;
    }
    private EditText input(String hint, int type) {
        EditText e = new EditText(this); e.setSingleLine(true); e.setHint(hint);
        e.setHintTextColor(0xffb6c5cb); e.setTextColor(PALE); e.setTextSize(15);
        e.setInputType(type); e.setPadding(dp(12),dp(8),dp(12),dp(8)); e.setBackground(bg(0xff244b60));
        return e;
    }
    private Button button(String s, boolean primary) {
        Button b = new Button(this); b.setText(s); b.setAllCaps(false); b.setTextSize(14);
        b.setTextColor(primary ? DARK : GOLD); b.setBackground(bg(primary ? GOLD : NAVY)); return b;
    }
    private void begin(String subtitle) {
        ScrollView scroll = new ScrollView(this); scroll.setFillViewport(true); scroll.setBackgroundColor(NAVY);
        page = new LinearLayout(this); page.setOrientation(LinearLayout.VERTICAL);
        page.setPadding(dp(18),dp(24),dp(18),dp(24)); page.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        TextView brand = text("AFAQ WALLET ✦",24,true); brand.setTextColor(GOLD); brand.setGravity(Gravity.CENTER);
        page.addView(brand, lp()); TextView sub = text(subtitle,14,false);
        sub.setGravity(Gravity.CENTER); sub.setPadding(0,dp(8),0,dp(20)); page.addView(sub,lp());
        scroll.addView(page); setContentView(scroll);
    }
    private LinearLayout.LayoutParams lp() { return new LinearLayout.LayoutParams(-1,-2); }
    private void gap(int h) { page.addView(new View(this),new LinearLayout.LayoutParams(1,dp(h))); }
    private void addField(EditText e) { page.addView(e,lp()); gap(10); }
    private void panel(View v) {
        v.setPadding(dp(14),dp(13),dp(14),dp(13)); v.setBackground(bg(0xff20475d));
        LinearLayout.LayoutParams p=lp(); p.bottomMargin=dp(10); page.addView(v,p);
    }
    private void showLogin() {
        begin("محفظتك الرقمية المستقلة");
        TextView intro=text("تسجيل الدخول بحسابك الحالي في AFAQ SYRIA",14,false); panel(intro);
        EditText login=input("البريد الإلكتروني أو رقم العضوية",1);
        EditText password=input("كلمة المرور",129); addField(login); addField(password);
        Button sign=button("تسجيل الدخول",true); page.addView(sign,lp());
        sign.setOnClickListener(v -> {
            String who=login.getText().toString().trim(), pass=password.getText().toString();
            if(who.isEmpty()||pass.isEmpty()){toast("أدخل بيانات الدخول");return;}
            sign.setEnabled(false);
            io.execute(() -> {
                try {
                    JSONObject body=new JSONObject(); body.put("login",who); body.put("password",pass);
                    JSONObject r=call("POST","/api/member/login",body,null,null);
                    String t=r.getString("token"); saveToken(t); token=t;
                    runOnUiThread(this::loadAccount);
                } catch(Exception e){runOnUiThread(()->{sign.setEnabled(true);toast(err(e));});}
            });
        });
        gap(18); TextView foot=text("واجهة Android أصلية • اتصال آمن بخادم آفاق سوريا",11,false);
        foot.setGravity(Gravity.CENTER); page.addView(foot,lp());
    }
    private void loadAccount() {
        begin("الحساب والأرصدة");
        TextView wait=text("جارٍ تحميل بيانات حسابك...",14,false); page.addView(wait,lp());
        io.execute(() -> {
            try {
                JSONObject me=call("GET","/api/member/me",null,token,null);
                JSONObject hist=call("GET","/api/member/transfers",null,token,null);
                runOnUiThread(()->render(me,hist));
            } catch(Exception e) {
                runOnUiThread(()->{
                    if(err(e).contains("401")||err(e).toLowerCase(Locale.ROOT).contains("unauthorized")){
                        clearToken(); token=""; showLogin();
                    } else { begin("تعذر الاتصال"); panel(text(err(e),13,false));
                        Button retry=button("إعادة المحاولة",true); page.addView(retry,lp()); retry.setOnClickListener(v->loadAccount());}
                });
            }
        });
    }
    private void render(JSONObject me, JSONObject hist) {
        JSONObject member=me.optJSONObject("member"); if(member==null) member=new JSONObject();
        begin("مرحباً "+member.optString("name","بك"));
        panel(text("رقم العضوية: "+member.optString("member_id","—")+"\nرقم الحساب: "+member.optString("account_number","—"),13,false));
        TextView title=text("الأرصدة حسب العملة",17,true); page.addView(title,lp()); gap(8);
        JSONArray balances=me.optJSONArray("balances");
        if(balances!=null) for(int i=0;i<balances.length();i++){
            JSONObject x=balances.optJSONObject(i); if(x==null)continue;
            panel(text(x.optString("currency")+"      "+String.format(Locale.US,"%.2f",x.optDouble("balance")),15,true));
        }
        Button refresh=button("تحديث الأرصدة",true); page.addView(refresh,lp()); refresh.setOnClickListener(v->loadAccount());
        gap(8); Button mining=button("🐝 تعدين عملة AOB",false); page.addView(mining,lp());
        mining.setOnClickListener(v->showMining());
        gap(8); Button transfer=button("تحويل داخلي إلى عضو",false); page.addView(transfer,lp());
        transfer.setOnClickListener(v->transferForm()); gap(18);
        page.addView(text("سجل التحويلات",17,true),lp()); gap(8);
        JSONArray transfers=hist.optJSONArray("transfers");
        if(transfers==null||transfers.length()==0) panel(text("لا توجد تحويلات مسجلة",13,false));
        else for(int i=0;i<transfers.length();i++){
            JSONObject x=transfers.optJSONObject(i); if(x==null)continue;
            panel(text(x.optString("transfer_id")+"\n"+(x.optString("direction").equals("out")?"صادر":"وارد")+
                " • "+x.optString("amount")+" "+x.optString("currency")+"\n"+x.optString("created_at"),13,false));
        }
        gap(14); Button logout=button("تسجيل الخروج",false); page.addView(logout,lp());
        logout.setOnClickListener(v->{
            io.execute(()->{try{call("POST","/api/member/logout",new JSONObject(),token,null);}catch(Exception ignored){}
                clearToken();token="";runOnUiThread(this::showLogin);});
        });
        gap(12); panel(text("نسخة تجريبية: الإيداع والسحب الخارجي غير متاحين حتى إتمام ربط مزود دفع مرخّص واختباره. التحويلات الداخلية تتطلب رصيداً كافياً.",11,false));
    }
    private void showMining() {
        stopBee();
        begin("تعدين عملة AOB – AFAQ ORBIT");
        TextView bee = text("🐝",64,true); bee.setGravity(Gravity.CENTER); panel(bee);
        beeAnimator = ValueAnimator.ofFloat(-dp(9), dp(9));
        beeAnimator.setDuration(650); beeAnimator.setRepeatMode(ValueAnimator.REVERSE);
        beeAnimator.setRepeatCount(ValueAnimator.INFINITE); beeAnimator.setInterpolator(new LinearInterpolator());
        beeAnimator.addUpdateListener(a -> bee.setTranslationY((Float)a.getAnimatedValue()));
        TextView status=text("النحلة جاهزة لبدء جلسة التعدين",16,true); status.setGravity(Gravity.CENTER); panel(status);
        TextView balance=text("رصيد AOB: يُعرض بعد اعتماد المكافآت من الخادم",13,false);
        panel(balance);
        Button start=button("ابدأ التعدين",true); page.addView(start,lp());
        Button stop=button("إيقاف التعدين",false); page.addView(stop,lp());
        start.setOnClickListener(v -> {
            if(beeAnimator!=null && beeAnimator.isRunning()) return;
            beeAnimator.start(); status.setText("🐝 النحلة تعمل — جلسة تجريبية");
            toast("بدأ العرض التجريبي. لم تُحتسب عملات في الرصيد بعد.");
        });
        stop.setOnClickListener(v -> {
            stopBee(); status.setText("تم إيقاف جلسة التعدين التجريبية");
        });
        gap(10); Button back=button("العودة إلى المحفظة",false); page.addView(back,lp());
        back.setOnClickListener(v->{stopBee();loadAccount();});
        gap(12); panel(text("تنبيه: هذه واجهة تجريبية للحركة فقط. لا يوجد حالياً API تعدين موثّق في الخادم، لذلك لا تُنشأ مكافآت ولا يُضاف رصيد AOB تلقائياً. لن نعرض أرباحاً وهمية.",11,false));
    }
    private void stopBee() {
        if(beeAnimator!=null){beeAnimator.cancel();beeAnimator=null;}
    }
    private void transferForm() {
        begin("تحويل داخلي بين أعضاء آفاق سوريا");
        EditText recipient=input("رقم العضوية OA أو رقم الحساب AQ",1);
        EditText amount=input("المبلغ",8194);
        EditText currency=input("العملة مثل USD أو EUR أو TRY أو SYP",1);
        EditText note=input("ملاحظة اختيارية",1);
        addField(recipient);addField(amount);addField(currency);addField(note);
        Button submit=button("مراجعة وتأكيد التحويل",true);page.addView(submit,lp());
        gap(8);Button cancel=button("العودة للمحفظة",false);page.addView(cancel,lp());cancel.setOnClickListener(v->loadAccount());
        submit.setOnClickListener(v->{
            String to=recipient.getText().toString().trim(), a=amount.getText().toString().trim();
            String cur=currency.getText().toString().trim().toUpperCase(Locale.ROOT);
            try{if(to.isEmpty()||cur.isEmpty()||Double.parseDouble(a)<=0)throw new Exception();}
            catch(Exception e){toast("تحقق من المستلم والمبلغ والعملة");return;}
            new AlertDialog.Builder(this).setTitle("تأكيد التحويل")
                .setMessage("تحويل "+a+" "+cur+" إلى "+to+"؟ تأكد من بيانات المستلم.")
                .setNegativeButton("إلغاء",null).setPositiveButton("تأكيد",(d,w)->sendTransfer(to,a,cur,note.getText().toString())).show();
        });
    }
    private void sendTransfer(String to,String amount,String currency,String note) {
        io.execute(()->{
            try{
                JSONObject body=new JSONObject();body.put("recipient",to);body.put("amount",amount);
                body.put("currency",currency);body.put("note",note);
                JSONObject r=call("POST","/api/member/transfer",body,token,UUID.randomUUID().toString());
                JSONObject tr=r.optJSONObject("transfer");
                runOnUiThread(()->{toast("تم تنفيذ التحويل: "+(tr==null?"":tr.optString("transfer_id")));loadAccount();});
            }catch(Exception e){runOnUiThread(()->toast(err(e)));}
        });
    }
    private JSONObject call(String method,String path,JSONObject body,String bearer,String idem)throws Exception{
        HttpURLConnection c=(HttpURLConnection)new URL(API+path).openConnection();
        c.setRequestMethod(method);c.setConnectTimeout(15000);c.setReadTimeout(20000);
        c.setRequestProperty("Accept","application/json");
        if(bearer!=null)c.setRequestProperty("Authorization","Bearer "+bearer);
        if(idem!=null)c.setRequestProperty("Idempotency-Key",idem);
        if(body!=null){c.setDoOutput(true);c.setRequestProperty("Content-Type","application/json; charset=utf-8");
            try(OutputStream o=c.getOutputStream()){o.write(body.toString().getBytes(StandardCharsets.UTF_8));}}
        int status=c.getResponseCode();InputStream s=status>=400?c.getErrorStream():c.getInputStream();
        StringBuilder out=new StringBuilder();if(s!=null)try(BufferedReader r=new BufferedReader(new InputStreamReader(s,StandardCharsets.UTF_8))){
            String line;while((line=r.readLine())!=null)out.append(line);}
        c.disconnect();JSONObject data=new JSONObject(out.toString());
        if(status<200||status>=300||!data.optBoolean("ok",false))throw new IOException(data.optString("error","HTTP "+status)+" ("+status+")");
        return data;
    }
    private SecretKey key() throws Exception {
        KeyStore ks=KeyStore.getInstance("AndroidKeyStore");ks.load(null);
        if(ks.containsAlias("afaq.wallet.token"))return (SecretKey)ks.getKey("afaq.wallet.token",null);
        KeyGenerator g=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
        g.init(new KeyGenParameterSpec.Builder("afaq.wallet.token",KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
        return g.generateKey();
    }
    private void saveToken(String value)throws Exception{
        Cipher c=Cipher.getInstance("AES/GCM/NoPadding");c.init(Cipher.ENCRYPT_MODE,key());
        byte[] encrypted=c.doFinal(value.getBytes(StandardCharsets.UTF_8));
        prefs.edit().putString("token_iv",android.util.Base64.encodeToString(c.getIV(),android.util.Base64.NO_WRAP))
            .putString("token_data",android.util.Base64.encodeToString(encrypted,android.util.Base64.NO_WRAP)).apply();
    }
    private String readToken(){
        try{
            String ivs=prefs.getString("token_iv",""),data=prefs.getString("token_data","");
            if(ivs.isEmpty()||data.isEmpty())return "";
            byte[] iv=android.util.Base64.decode(ivs,android.util.Base64.NO_WRAP);
            byte[] enc=android.util.Base64.decode(data,android.util.Base64.NO_WRAP);
            Cipher c=Cipher.getInstance("AES/GCM/NoPadding");c.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,iv));
            return new String(c.doFinal(enc),StandardCharsets.UTF_8);
        }catch(Exception e){return "";}
    }
    private void clearToken(){prefs.edit().remove("token_iv").remove("token_data").apply();}
    private String err(Exception e){return e.getMessage()==null?"خطأ في الاتصال بالخادم":e.getMessage();}
    private void toast(String s){Toast.makeText(this,s,Toast.LENGTH_LONG).show();}
    @Override protected void onDestroy(){stopBee();super.onDestroy();io.shutdown();}
}
