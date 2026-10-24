use std::path::{Path,PathBuf};
pub type Res<T> = Result<T,String>;
pub fn err(e: impl std::fmt::Display)->String {e.to_string()}
pub fn confined(root:&Path,input:&str)->Res<PathBuf>{let p=if Path::new(input).is_absolute(){PathBuf::from(input)}else{root.join(input)}.canonicalize().map_err(err)?;if !p.starts_with(root){return Err("Arquivo fora do projeto".into())}Ok(p)}
