

class StreamResponseSeeker:
    """
    Tiny state machine that reads the raw JSON text stream and prints ONLY
    the value of the "response" field as it arrives, handling escapes.
    """

    def __init__(self):
        self.state = "LOOKING_FOR_KEY"  # LOOKING_FOR_KEY -> AFTER_COLON -> IN_STRING -> DONE
        self.key_buf = ""
        self.after_colon = False
        self.done = False
        self.escaped = False  # Track if we're in an escape sequence

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
                    i += 1
                    continue
                # Unexpected non-quote; reset and try to find key again
                self.state = "LOOKING_FOR_KEY"
                self.key_buf = ""
                continue

            if self.state == "IN_STRING":
                if self.escaped:
                    # Handle escape sequences
                    if ch == '"':
                        yield '"'  # Escaped quote - yield it, don't end string
                    elif ch == '\\':
                        yield '\\'  # Escaped backslash
                    elif ch == 'n':
                        yield '\n'  # Newline
                    elif ch == 't':
                        yield '\t'  # Tab
                    elif ch == 'r':
                        yield '\r'  # Carriage return
                    else:
                        yield '\\'  # Unknown escape, yield backslash
                        yield ch    # and the character
                    self.escaped = False
                    i += 1
                    continue
                
                if ch == '\\':
                    # Start of escape sequence
                    self.escaped = True
                    i += 1
                    continue
                
                if ch == '"':
                    # Unescaped quote - end of string
                    self.done = True
                    i += 1
                    continue
                yield ch
                i += 1
                continue
            i += 1
