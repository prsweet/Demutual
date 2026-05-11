  1. The Jupiter V2 Bug
    You discovered a bug in Jupiter's brand new V2 API.
  
    When you use the old V1 API (/swap/v1/quote) and pass it a fake or invalid
    token address, it cleanly replies with a 400 Bad Request and says
    {"error":"The token ... is not
    tradable","errorCode":"TOKEN_NOT_TRADABLE"}.
  
    But when you use the new V2 Meta-Aggregator (/swap/v2/order) and pass it
    an invalid token, the Jupiter server internally crashes. It spits out a
    500 Internal Server Error with {"error":"Something unexpected occurred"}
    instead of telling you what actually went wrong.


Some tokens Jupiter Tokens v2 returns the same
  broken github URL that we already had — Jupiter's
  icon field isn't a CDN, it's just whatever the token
   submitter registered. ETH was a clear example in my
   live test. So the runtime overlay was strictly an
  improvement but couldn't cover every case. With
  DB-backed plus the curated override file, you can
  now fix any remaining icon without a code change to
  the catalog seed — just one entry in
  CURATED_TOKEN_OVERRIDES.
