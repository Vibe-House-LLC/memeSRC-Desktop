const { Client } = require('@opensearch-project/opensearch');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

const inputArg = process.argv[2]; // This assumes the input argument is the first after the script name

async function indexCsv() {
  const OPENSEARCH_ENDPOINT = "https://search-memesrc-3lcaiflaubqkqafuim5oyxupwa.us-east-1.es.amazonaws.com";
  const OPENSEARCH_USER = "davis";
  const OPENSEARCH_PASS = process.env.OPENSEARCH_PASS;

  const client = new Client({
    node: OPENSEARCH_ENDPOINT,
    auth: {
      username: OPENSEARCH_USER,
      password: OPENSEARCH_PASS,
    },
  });

  const csvPath = path.join(process.env.HOME, '.memesrc', 'processing', inputArg, '_docs.csv');
  const indexName = `v2-${inputArg}`;
  const batchSize = 100; // Adjust the batch size as needed

  try {
    const rows = [];

    await new Promise((resolve, reject) => {
      fs.createReadStream(csvPath)
        .pipe(csv())
        .on('data', (row) => {
          if (row.subtitle_text) {
            const decodedSubtitle = Buffer.from(row.subtitle_text, 'base64').toString('utf-8');
            row.subtitle_text = decodedSubtitle;
          }
          rows.push(row);
        })
        .on('end', resolve)
        .on('error', reject);
    });

    const batches = [];
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const bulkBody = batch.flatMap((doc) => [
        { index: { _index: indexName } },
        doc,
      ]);
      batches.push(bulkBody);
    }

    let processedCount = 0;

    for (const bulkBody of batches) {
      const bulkResponse = await client.bulk({
        body: bulkBody,
      });
      console.log("Bulk indexing response:", bulkResponse.body);
      processedCount += bulkBody.length / 2;
      console.log(`Processed ${processedCount} out of ${rows.length} rows`);
    }

    console.log('CSV indexing completed.');
  } catch (error) {
    console.error('Error indexing CSV:', error);
  }
}

indexCsv();
