-- Custom luacheck --formatter module that emits JSON.
--
-- luacheck resolves a custom formatter by require-ing the module name and
-- calling its return value as formatter_func(report, filenames, options)
-- (see luacheck/runner.lua). The module must therefore return a function,
-- not a table with a .format method.
--
-- report is an array; report[i] is the array of final, already filtered
-- warnings for filenames[i]. Each warning is rendered through
-- luacheck.get_message so the output can be compared against this port's
-- getMessage output on rendered message text plus line and column.
--
-- No third-party JSON library is used; the encoder below is self-contained.

local luacheck = require "luacheck"

local escapes = {
   ['"'] = '\\"',
   ["\\"] = "\\\\",
   ["\b"] = "\\b",
   ["\f"] = "\\f",
   ["\n"] = "\\n",
   ["\r"] = "\\r",
   ["\t"] = "\\t",
}

local function json_encode_string(s)
   local parts = {}

   for i = 1, #s do
      local c = s:sub(i, i)
      local esc = escapes[c]

      if esc then
         parts[#parts + 1] = esc
      else
         local byte = c:byte()

         if byte < 0x20 then
            parts[#parts + 1] = string.format("\\u%04x", byte)
         else
            parts[#parts + 1] = c
         end
      end
   end

   return '"' .. table.concat(parts) .. '"'
end

-- Forward declaration: json_encode_table calls json_encode, which is
-- assigned below.
local json_encode

local function json_encode_table(t)
   -- A table is an array only if every key is a positive integer and the
   -- keys form a contiguous 1..#t range. Our data has no holes.
   local array = true
   local count = 0

   for k in pairs(t) do
      count = count + 1

      if type(k) ~= "number" or k < 1 or k % 1 ~= 0 then
         array = false
      end
   end

   if array and count == #t then
      local parts = {}

      for i = 1, #t do
         parts[i] = json_encode(t[i])
      end

      return "[" .. table.concat(parts, ",") .. "]"
   end

   -- Object. Sort string keys so the output is stable across runs.
   local keys = {}

   for k in pairs(t) do
      if type(k) ~= "string" then
         error("json_formatter: cannot encode non-string object key")
      end

      keys[#keys + 1] = k
   end

   table.sort(keys)

   local parts = {}

   for i, k in ipairs(keys) do
      parts[i] = json_encode_string(k) .. ":" .. json_encode(t[k])
   end

   return "{" .. table.concat(parts, ",") .. "}"
end

json_encode = function(value)
   local value_type = type(value)

   if value_type == "nil" then
      return "null"
   elseif value_type == "boolean" then
      return value and "true" or "false"
   elseif value_type == "number" then
      if value ~= value or value == math.huge or value == -math.huge then
         error("json_formatter: cannot encode non-finite number")
      end

      return tostring(value)
   elseif value_type == "string" then
      return json_encode_string(value)
   elseif value_type == "table" then
      return json_encode_table(value)
   else
      error("json_formatter: cannot encode value of type " .. value_type)
   end
end

-- Callback signature fixed by luacheck's runner (runner.lua calls
-- formatter_func(report, filenames, options)). Options is intentionally
-- unused here; the `_` prefix marks it as such for luacheck.
local function format(report, filenames, _options)
   local entries = {}

   for i = 1, #report do
      local warnings = report[i]
      local encoded_warnings = {}

      for j = 1, #warnings do
         local w = warnings[j]

         -- luacheck stores warning codes as numeric strings ("113"). Emit
         -- them as JSON numbers to match this TS port's Warning.code, which
         -- is a number literal. Fall back to the raw string if non-numeric.
         encoded_warnings[j] = {
            code = tonumber(w.code) or w.code,
            line = w.line,
            column = w.column,
            message = luacheck.get_message(w),
         }
      end

      entries[i] = {
         filename = filenames[i],
         warnings = encoded_warnings,
      }
   end

   return json_encode(entries)
end

return format
