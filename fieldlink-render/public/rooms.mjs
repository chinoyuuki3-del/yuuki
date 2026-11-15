export function roomCode(value){
 let text=String(value??'').normalize('NFKC').trim();if(text.length>2048)return null;
 if(/^https?:\/\//i.test(text)){try{text=new URL(text).searchParams.get('room')||'';}catch{return null;}}
 text=text.replace(/[\s-]/g,'').toUpperCase();return /^[A-F0-9]{8}$/.test(text)?text:null;
}
export function roomIntent(value){return String(value??'').trim()?'join':'create';}
export function roomCodeError(value){return /^[A-F0-9]{10}$/i.test(String(value).trim())?'これは友達コードです。対戦待機画面の8文字のルームコードを入力してね。':'8文字のルームコード、またはルームの招待リンクを入力してね。';}
