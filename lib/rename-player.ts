// Compare the whole snapshot so renaming cannot overwrite a concurrent move.
// Keep the existing expiry, including an unclaimed invitation with no expiry.
export const RENAME_PLAYER = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2], 'KEEPTTL')
return 1
`;
