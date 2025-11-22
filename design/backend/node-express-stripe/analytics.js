const persistence = require('./persistence');
const validation = require('./validation-stubs');

// Simple email pattern to detect unhashed identifiers
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
// SHA-256 hex pattern (64 hex chars)
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/i;

function enforceUserIdPrivacy(payload){
  if(!process.env.ENFORCE_USER_ID_HASH || process.env.ENFORCE_USER_ID_HASH !== 'true') return null;
  // Identify possible user id field names across events
  const candidateFields = ['user_id','student_id','teacher_id'];
  for(const field of candidateFields){
    if(field in payload){
      const val = payload[field];
      if(typeof val === 'string'){
        const isEmail = EMAIL_PATTERN.test(val);
        const isHash = SHA256_HEX_PATTERN.test(val);
        if(isEmail || !isHash){
          return { error:'user_id_not_hashed', field, provided: val };
        }
      }else{
        return { error:'user_id_invalid_type', field };
      }
    }
  }
  return null;
}

function trackEvent(name, payload){
  const result = validation.validateAnalyticsEventPayload(name, payload);
  if(!result.valid){
    return { stored:false, error: result.error, field: result.field };
  }
  const privacyIssue = enforceUserIdPrivacy(payload);
  if(privacyIssue){
    return { stored:false, error: privacyIssue.error, field: privacyIssue.field };
  }
  persistence.addAnalyticsEvent(name, payload);
  return { stored:true };
}

module.exports = { trackEvent };