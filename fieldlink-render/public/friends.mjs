export function friendCode(value){
 let text=String(value??'').normalize('NFKC').trim();
 if(text.length>2048)return null;
 if(/^https?:\/\//i.test(text)){try{text=new URL(text).searchParams.get('friend')||'';}catch{return null;}}
 text=text.replace(/[\s-]/g,'').toUpperCase();
 return /^[A-F0-9]{10}$/.test(text)?text:null;
}
export function friendCodeError(value){
 return /^[A-F0-9]{8}$/i.test(String(value).trim())?'これは対戦ルームのコードです。フレンド画面にある10文字の友達コードを使ってね。':'10文字の友達コード、またはコピーした招待リンクを入力してね。';
}
