# UI copy — Void Jump In flow
Edit any line and hand this back. Keys are stable references; text is what renders.

## Screen 1 · Jump in
s1.logo:            THE⬡VOID
s1.live:            {n} WINDOWS OPEN RIGHT NOW
s1.headline:        The world, unranked, from the people standing in it.
s1.cta:             JUMP INTO THE VOID
s1.signin:          ALREADY HAVE A CARD · SIGN IN
s1.tile.live:       LIVE
s1.tile.watching:   {n} WATCHING

## Screen 2 · The Globe
s2.eyebrow:         THE GLOBE · 195 NATIONS
s2.headline:        Every light is someone streaming. They come and go like stars.
s2.body:            No algorithm decides which ones you see. You turn the globe, you pick the light.
s2.hint:            DRAG TO TURN
s2.cta:             CLAIM A SIGNAL

## Screen 3 · The Signal Card
s3.eyebrow:         IDENTITY · 3 OF 4
s3.tab.new:         NEW USER
s3.tab.login:       LOGIN
s3.card.logo:       THE⬡VOID
s3.card.date:       {YYYY.MM.DD}

### New user
s3.new.headline:            Your card. Print a name on it, or don't.
s3.new.handle.placeholder:  nobody
s3.new.providers.empty:     TYPE A HANDLE, THEN SIGN UP WITH
s3.new.providers.filled:    SIGN UP @{HANDLE} WITH
s3.new.provider.apple:      APPLE
s3.new.provider.google:     GOOGLE
s3.new.provider.email:      EMAIL
s3.new.blank.cta:           ENTER BLANK
s3.new.legal.blank:         NO NAME · NO EMAIL · NOTHING TO LEAK
s3.new.legal.filled:        YOUR HANDLE IS SAVED WITH WHICHEVER YOU PICK
s3.new.email.eyebrow:       SIGN UP @{HANDLE} · EMAIL
s3.new.email.placeholder:   you@anywhere
s3.new.email.cta:           CONTINUE
s3.new.email.legal:         EMAIL STAYS PRIVATE · NEVER SHOWN
s3.new.pass.eyebrow:        {EMAIL} · SET A PASSWORD
s3.new.pass.placeholder:    password · 8+ characters
s3.new.pass2.placeholder:   confirm password
s3.new.pass.cta:            ISSUE THE CARD

### Login
s3.login.headline:            Welcome back. Your card, your handle.
s3.login.handle.placeholder:  yourhandle
s3.login.toggle.toPass:       ENTER PASSWORD
s3.login.toggle.toHandle:     ENTER USERNAME
s3.login.card.passLabel:      PASSWORD · @{handle}
s3.login.pass.placeholder:    password
s3.login.show:                SHOW
s3.login.hide:                HIDE
s3.login.globeHint:           TAP THE GLOBE TO ENTER
s3.login.providers:           OR SIGN IN WITH
s3.login.email.placeholder:   you@anywhere
s3.login.email.pass:          password
s3.login.email.cta:           SIGN IN
s3.login.legal:               FOUR WAYS IN · EACH ONE STANDS ALONE

### Errors (red mono line)
err.handle.missing.new:     TYPE A HANDLE ON THE CARD FIRST
err.handle.missing.login:   TYPE YOUR HANDLE ON THE CARD
err.handle.format:          2+ LETTERS, NUMBERS, _ AND . ONLY
err.email:                  VALID EMAIL
err.pass.missing:           ENTER YOUR PASSWORD
err.pass.short:             8+ CHARACTER PASSWORD
err.pass.mismatch:          PASSWORDS DON'T MATCH
err.server.handleTaken:     HANDLE TAKEN            (proposed, not in mock)
err.server.badLogin:        WRONG HANDLE OR PASSWORD (proposed, not in mock)
err.server.noAccount:       NO CARD FOUND · TRY NEW USER (proposed, not in mock)

### Success state
s3.done.anon:        You are nobody here.
s3.done.new:         @{handle}, your card is issued.
s3.done.login:       @{handle}, you're back.
s3.done.login.noHandle: Welcome back.
s3.done.label.new:   SIGNAL ACQUIRED
s3.done.label.login: CARD FOUND

## Screen 4 · Ignite the feed
s4.eyebrow:          IGNITE THE FEED · {n} CHOSEN
s4.headline.0:       What should reach you first?
s4.headline.1to2:    Good. Two more and the feed knows you.
s4.headline.3plus:   Enough to start. It learns from every bolt.
s4.section.signal:   SIGNAL
s4.section.places:   PLACES
s4.section.live:     LIVE NOW
s4.topics:           Live streams · Breaking · Streets · Music · Conflict · Weather · Food · Faith · Protest · Night
s4.places:           Tokyo JP · Istanbul TR · New York US · Seoul KR · Sydney AU · Jerusalem IL · Taipei TW · Baku AZ · Yerevan AM · Kyiv UA · St Petersburg RU · Addis Ababa ET · Paris FR · Berlin DE
s4.cta.empty:        SHOW ME EVERYTHING
s4.cta.filled:       IGNITE THE FEED

## Screen 5 · Lit
s5.line.empty:       Everything, then. The void starts wide.
s5.line.filled:      {Place} and {Place}[ and {n} more], tuned to {topic, topic, topic}.
s5.line.login:       Your feed, where you left it.
s5.label:            FEED IGNITED · OPENING
