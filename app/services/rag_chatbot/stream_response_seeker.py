

class StreamResponseSeeker:
    """
    Tiny state machine that reads the raw JSON text stream and prints ONLY
    the value of the "response" field as it arrives, handling escapes.
    """

    def __init__(self):
        self.state = "LOOKING_FOR_KEY"  # LOOKING_FOR_KEY -> AFTER_COLON -> IN_STRING -> DONE
        self.key_buf = ""
        self.after_colon = False
        self.in_string = False
        self.escaped = False
        self.done = False

        # Unicode escape handling
        self.in_unicode = False
        self.unicode_buf = ""
        self.unicode_needed = 0  # remaining hex digits to read (exactly 4 for \uXXXX)

    def _emit_escape(self, ch):
        """Map a single-character escape after backslash to its decoded char."""
        mapping = {
            '"': '"',
            "\\": "\\",
            "/": "/",
            "b": "\b",
            "f": "\f",
            "n": "\n",
            "r": "\r",
            "t": "\t",
        }
        return mapping.get(ch, ch)  # default: pass through unknown escapes

    def feed(self, chunk: str):
        if self.done:
            return
        i = 0
        while i < len(chunk) and not self.done:
            ch = chunk[i]

            if self.state == "LOOKING_FOR_KEY":
                # Grow a rolling window up to length len('"response"')
                self.key_buf = (self.key_buf + ch)[-10:]  # len('"response"') == 10
                if self.key_buf == '"response"':
                    self.state = "AFTER_COLON"
                    self.after_colon = False
                i += 1
                continue

            if self.state == "AFTER_COLON":
                # Seek colon, then opening quote
                if not self.after_colon:
                    if ch == ":":
                        self.after_colon = True
                    i += 1
                    continue
                # After colon: skip whitespace until opening quote
                if ch in " \t\r\n":
                    i += 1
                    continue
                if ch == '"':
                    self.state = "IN_STRING"
                    self.in_string = True
                    self.escaped = False
                    self.in_unicode = False
                    self.unicode_buf = ""
                    self.unicode_needed = 0
                    i += 1
                    continue
                # unexpected: reset and look for key again
                self.state = "LOOKING_FOR_KEY"
                self.key_buf = ""
                continue

            if self.state == "IN_STRING":
                # Handle ongoing \uXXXX collection
                if self.in_unicode:
                    # Collect exactly 4 hex digits (JSON spec)
                    if ch.lower() in "0123456789abcdef":
                        self.unicode_buf += ch
                        self.unicode_needed -= 1
                        i += 1
                        if self.unicode_needed == 0:
                            # Emit the decoded unicode char
                            try:
                                yield chr(int(self.unicode_buf, 16))
                            except ValueError:
                                # Fallback: emit literally if somehow invalid
                                for lit in ("\\", "u") + tuple(self.unicode_buf):
                                    yield lit
                            # reset unicode state
                            self.in_unicode = False
                            self.unicode_buf = ""
                        continue
                    else:
                        # Invalid sequence; emit literally and reset
                        for lit in ("\\", "u") + tuple(self.unicode_buf):
                            yield lit
                        self.in_unicode = False
                        self.unicode_buf = ""
                        # do not consume current ch here; reprocess it
                        continue

                if self.escaped:
                    # We just saw a backslash previously
                    if ch == "u":
                        # Begin unicode escape
                        self.in_unicode = True
                        self.unicode_buf = ""
                        self.unicode_needed = 4
                    else:
                        yield self._emit_escape(ch)
                    self.escaped = False
                    i += 1
                    continue
                # Not in any escape mode
                if ch == "\\":
                    self.escaped = True
                    i += 1
                    continue
                if ch == '"':
                    # End of the response string
                    self.done = True
                    i += 1
                    continue
                # Normal char inside the string
                yield ch
                i += 1
                continue

            # Shouldn't get here, but advance to avoid infinite loop
            i += 1
