import { ErrorWithCode } from "@calcom/lib/errors";

// Only types /api/avatar can serve: it strips png/jpeg prefixes, and SVG is converted to PNG on upload.
const LOGO_DATA_URL = /^data:image\/(png|jpeg|svg\+xml);base64,/;
const BASE64_BODY = /^[A-Za-z0-9+/]+={0,2}$/;
const MAX_LOGO_BYTES = 2 * 1024 * 1024;
// Capping the raw length first stops padding from shrinking the size estimate below.
const MAX_LOGO_BASE64_LENGTH = Math.ceil(MAX_LOGO_BYTES / 3) * 4;

// Throws BadRequest unless the logo is a small base64 image data URL the avatar route can serve.
export function validateTeamLogo(logo: string): void {
  const prefix = LOGO_DATA_URL.exec(logo);
  if (!prefix) {
    throw ErrorWithCode.Factory.BadRequest("The logo must be a base64 PNG, JPEG or SVG data URL");
  }
  const base64 = logo.slice(prefix[0].length);
  const tooLarge = () => ErrorWithCode.Factory.BadRequest("The logo must be 2 MB or smaller");
  if (base64.length > MAX_LOGO_BASE64_LENGTH) throw tooLarge();
  if (!BASE64_BODY.test(base64)) throw ErrorWithCode.Factory.BadRequest("The logo is not valid base64");
  const padding = /=*$/.exec(base64)?.[0].length ?? 0;
  if (Math.floor((base64.length * 3) / 4) - padding > MAX_LOGO_BYTES) throw tooLarge();
}
