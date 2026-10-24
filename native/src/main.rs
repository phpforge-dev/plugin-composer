mod workspace;
mod composer;
use serde_json::{json,Value};
use std::{path::PathBuf,sync::Arc};
use tokio::io::{AsyncBufReadExt,AsyncWriteExt,BufReader};
const LIMIT:usize=16*1024*1024;
#[tokio::main]
async fn main(){
 let root=std::env::args_os().nth(1).map(PathBuf::from).and_then(|p|p.canonicalize().ok()).filter(|p|p.is_dir()).expect("Canonical project required");
 let docker=std::env::args().nth(2).unwrap_or_else(||"docker".into());
 let service=Arc::new(composer::Composer::default());
 let(tx,mut rx)=tokio::sync::mpsc::channel::<Value>(64);
 let _output=tokio::spawn(async move {let mut out=tokio::io::stdout();while let Some(v)=rx.recv().await{let Ok(mut b)=serde_json::to_vec(&v)else{break};if b.len()>LIMIT{break}b.push(b'\n');if out.write_all(&b).await.is_err()||out.flush().await.is_err(){break}}});
 let mut input=BufReader::new(tokio::io::stdin());
 let slots=Arc::new(tokio::sync::Semaphore::new(64));
 loop{
  let mut bytes=Vec::new();
  // Bounded framing, including input without a newline.
  loop {let chunk=match input.fill_buf().await {Ok(v)=>v,Err(_)=>return};if chunk.is_empty(){return}let end=chunk.iter().position(|b|*b==b'\n').map(|n|n+1).unwrap_or(chunk.len());if bytes.len()+end>LIMIT{return}bytes.extend_from_slice(&chunk[..end]);input.consume(end);if bytes.last()==Some(&b'\n'){break}}
  let Ok(message)=serde_json::from_slice::<Value>(&bytes)else{return};
  let id=message["id"].clone();let method=message["method"].as_str().unwrap_or("").to_owned();
  if method=="shutdown" {return}
  let args=message["params"]["args"].as_array().cloned().unwrap_or_default();
  let service=service.clone();let root=root.clone();let docker=docker.clone();let tx=tx.clone();
  let Ok(permit)=slots.clone().try_acquire_owned()else{let _=tx.send(json!({"id":id,"error":{"message":"Too many requests"}})).await;continue};
  tokio::spawn(async move {
   let _permit=permit;
   if method=="initialize" {let _=tx.send(json!({"id":id,"result":{"protocolVersion":1}})).await;return}
   let events:Arc<dyn Fn(Value)+Send+Sync>={let tx=tx.clone();Arc::new(move |event|{if tx.try_send(json!({"method":"tool/event","params":event})).is_err(){eprintln!("Tool event queue full; client must refresh state");}})};
   let result:workspace::Res<Value>=service.dispatch(&root,events,&docker,&method,&args).await;
   let response=match result{Ok(value)=>json!({"id":id,"result":value}),Err(error)=>json!({"id":id,"error":{"message":error}})};
   let _=tx.send(response).await;
  });
 }
 #[allow(unreachable_code)] {let _=_output.await;}
}
