import { z } from 'zod';

const EXPECTED: Record<string, string> = {
  string: 'text',
  number: 'a number',
  int: 'a whole number',
  boolean: 'true or false',
  array: 'a list',
  object: 'an object',
};

/**
 * Plain-language messages for every validation failure that has no message of its own, so users
 * never see zod's wording ("expected string, received undefined"). A message written on a schema
 * still wins; this only replaces the defaults. Importing this file turns it on.
 */
z.config({
  customError: (issue) => {
    const missing = issue.input === undefined;
    switch (issue.code) {
      case 'invalid_type':
        return missing
          ? 'This field is required'
          : `Expected ${EXPECTED[issue.expected] ?? issue.expected}`;
      case 'invalid_union': // amounts accept a string or a number, so a missing one fails here
        return missing ? 'This field is required' : 'Invalid value';
      case 'too_small':
        if (issue.origin === 'string') {
          return issue.minimum === 1
            ? 'This field cannot be empty'
            : `Use at least ${issue.minimum} characters`;
        }
        return issue.inclusive === false
          ? `Must be greater than ${issue.minimum}`
          : `Must be at least ${issue.minimum}`;
      case 'too_big':
        return issue.origin === 'string'
          ? `Use at most ${issue.maximum} characters`
          : `Must be at most ${issue.maximum}`;
      case 'invalid_format':
        if (issue.format === 'email') return 'Enter a valid email address, like name@company.com';
        if (issue.format === 'date') return 'Enter a valid date as YYYY-MM-DD';
        return undefined;
      case 'invalid_value':
        return `Choose one of: ${issue.values.join(', ')}`;
      case 'unrecognized_keys':
        return `Unknown field: ${issue.keys.join(', ')}`;
      default:
        return undefined;
    }
  },
});
