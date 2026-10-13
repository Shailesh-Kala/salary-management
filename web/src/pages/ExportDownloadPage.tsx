import { Alert, Button, LinearProgress, Link as MuiLink, Stack, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { download } from '../api/client.ts';

/**
 * The page the export email links to. It saves the file with a `fetch` from the app itself, so
 * the session cookie is sent even when the link was opened from a webmail tab (D-032).
 */
export function ExportDownloadPage() {
  const { id } = useParams() as { id: string };
  const save = useQuery({
    queryKey: ['export-download', id],
    queryFn: async () => {
      await download(`/exports/${id}/download`);
      return true;
    },
    // Every download is audited, so it runs on arrival and again only when asked.
    retry: false,
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });

  return (
    <Stack spacing={2}>
      <Typography variant="h4" component="h1">
        Your export
      </Typography>
      {save.isPending && (
        <>
          <Typography>Downloading your PDF…</Typography>
          <LinearProgress />
        </>
      )}
      {save.isSuccess && (
        <Alert
          severity="success"
          action={<Button onClick={() => void save.refetch()}>Download again</Button>}
        >
          Your export has been saved to your downloads.
        </Alert>
      )}
      {save.isError && (
        <Alert severity="error">
          {save.error.message}{' '}
          <MuiLink component={Link} to="/exports">
            My exports
          </MuiLink>
        </Alert>
      )}
    </Stack>
  );
}
