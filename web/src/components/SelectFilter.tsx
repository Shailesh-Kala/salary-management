import { MenuItem, TextField } from '@mui/material';

export const asOptions = (values: string[] = []) => values.map((v) => ({ value: v, label: v }));

/** A labelled dropdown filter; `allLabel` adds an empty "all" choice. */
export function SelectFilter(props: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  allLabel?: string;
}) {
  return (
    <TextField
      select
      size="small"
      label={props.label}
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      sx={{ minWidth: 160 }}
      slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
    >
      {props.allLabel !== undefined && <MenuItem value="">{props.allLabel}</MenuItem>}
      {props.options.map((o) => (
        <MenuItem key={o.value} value={o.value}>
          {o.label}
        </MenuItem>
      ))}
    </TextField>
  );
}
