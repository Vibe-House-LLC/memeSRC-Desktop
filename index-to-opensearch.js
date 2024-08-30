const { Client } = require('@opensearch-project/opensearch');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

const inputArg = process.argv[2];

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

  const csvPath = path.join('/Volumes/SSD_External_1TB/', inputArg, '_docs.csv');
  const indexName = `v2-${inputArg}`;
  const batchSize = 750;
  const delayBetweenBatches = 500; // Delay in milliseconds (e.g., 1000ms = 1 second)

  console.log(csvPath)

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

      // Delay execution before processing the next batch
      await new Promise((resolve) => setTimeout(resolve, delayBetweenBatches));
    }

    console.log('CSV indexing completed.');
    return true;
  } catch (error) {
    console.error('Error indexing CSV:', error);
    return false;
  }
}

indexCsv();
