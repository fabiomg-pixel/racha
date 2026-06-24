// Pix "copia e cola" (BR Code / EMV-MPM) estático com valor.
// Gera a string do payload + CRC16; o QR é desenhado a partir dela (lib externa na UI).

// remove acento e limita o tamanho (nome ≤25, cidade ≤15 por spec)
function clean(s, max){
  return String(s || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^\x20-\x7E]/g, "")
    .toUpperCase().trim().slice(0, max);
}

// campo EMV: id + comprimento(2 dígitos) + valor
function tlv(id, value){
  const v = String(value);
  const len = String(v.length).padStart(2, "0");
  return id + len + v;
}

// CRC16/CCITT-FALSE (poly 0x1021, init 0xFFFF) — exigido no campo 63
export function crc16(str){
  let crc = 0xFFFF;
  for(let i = 0; i < str.length; i++){
    crc ^= str.charCodeAt(i) << 8;
    for(let b = 0; b < 8; b++){
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
      crc &= 0xFFFF;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

// { key, name, city, amount?, txid?, description? } -> string copia-e-cola
export function buildPixPayload({ key, name, city, amount, txid, description }){
  if(!key) throw new Error("sem chave pix");

  let gui = tlv("00", "br.gov.bcb.pix") + tlv("01", String(key).trim());
  if(description) gui += tlv("02", clean(description, 60));
  const merchantAccount = tlv("26", gui);

  let payload =
    tlv("00", "01") +                 // payload format indicator
    merchantAccount +
    tlv("52", "0000") +               // merchant category code
    tlv("53", "986");                 // moeda BRL

  if(amount != null && Number(amount) > 0){
    payload += tlv("54", Number(amount).toFixed(2));
  }

  payload +=
    tlv("58", "BR") +
    tlv("59", clean(name, 25) || "RECEBEDOR") +
    tlv("60", clean(city, 15) || "BRASIL") +
    tlv("62", tlv("05", clean(txid || "***", 25)));

  payload += "6304";                  // id+len do CRC; o valor entra a seguir
  return payload + crc16(payload);
}

// valida que uma string copia-e-cola tem o CRC correto (útil em teste)
export function validatePix(payload){
  if(typeof payload !== "string" || payload.length < 8) return false;
  const body = payload.slice(0, -4);
  const given = payload.slice(-4).toUpperCase();
  return crc16(body) === given;
}
