# The principal and the sign-in answer are built from one membership picture

The six role groups and their seven levels were written out in three places - the role schema, the merge of a user's roles in `UserManager.getUserPermissions`, and the rights table - and the principal of the authorization was built from the sign-in answer, the form the Admin UI reads: a new level had to be added three times, and the principal depended on a client contract it does not need (its owner defaults, its `freeBookings`, its `adminInterfaces`). We decided that one catalogue names the groups and levels (`entities/role/role-catalogue.js`) and everything else derives from it, and that one loader, `UserManager.getMembershipPicture`, reads what the principal and the sign-in answer need - the instance flags and, per active membership, the owner flag, the supervision of the tenant, the levels merged over the catalogue and the extras of the roles - once per user, with the roles of a tenant in one query. The principal is built from that picture; the sign-in answer is a projection of it and never its source. The alternatives were leaving the principal on the sign-in answer (keeps the coupling) and handing the raw roles to both (merges twice).

## Consequences

- A group or level is added in the catalogue and nowhere else; the schema, the merge and the table's check follow.
- The sign-in answer keeps its contract (the Admin UI's `permissions`): a declined tenant still shows every flag there, only the principal lets the membership rest (#299, Q12). A test holds the form of the answer.
- Tests of the rights stub the membership picture, not the sign-in answer; the route world runs the loader for real over stubbed managers.
- What the sign-in answer carries beyond the picture (the owner's default admin interfaces) is the projection's, not the loader's.
