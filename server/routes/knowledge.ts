import { Router } from 'express';
import { getKnowledgeService, type KnowledgeCategory } from '../rag/knowledge-service';
import { requireRole } from '../auth/middleware';
import { sendFailure } from '../lib/failure';

const router = Router();
const knowledgeService = getKnowledgeService();
// Reads stay open to every signed-in user (mounted behind requireAuth) since
// the knowledge base feeds AI replies everyone relies on; writes are
// manager+ since these documents steer AI-drafted customer-facing messages.
const writeGate = requireRole('manager');

// Get all knowledge documents
router.get('/documents', async (req, res) => {
  try {
    const category = req.query.category as KnowledgeCategory | undefined;
    const documents = await knowledgeService.getDocuments(category);
    res.json(documents);
  } catch (error: any) {
    return sendFailure(res, error, 'GET /api/knowledge/documents');
  }
});

// Get a single document
router.get('/documents/:id', async (req, res) => {
  try {
    const document = await knowledgeService.getDocument(parseInt(req.params.id));
    if (!document) {
      return res.status(404).json({ message: 'Document not found' });
    }
    res.json(document);
  } catch (error: any) {
    return sendFailure(res, error, 'GET /api/knowledge/documents/:id');
  }
});

// Create a new document
router.post('/documents', writeGate, async (req, res) => {
  try {
    const { title, content, category, tags, source, metadata } = req.body;

    if (!title || !content || !category) {
      return res.status(400).json({ message: 'Title, content, and category are required' });
    }

    const document = await knowledgeService.addDocument({
      title,
      content,
      category,
      tags: tags || [],
      source,
      metadata,
      active: true,
    });

    res.status(201).json(document);
  } catch (error: any) {
    return sendFailure(res, error, 'POST /api/knowledge/documents');
  }
});

// Update a document
router.put('/documents/:id', writeGate, async (req, res) => {
  try {
    const { title, content, category, tags, active, metadata } = req.body;

    const document = await knowledgeService.updateDocument(parseInt(req.params.id), {
      title,
      content,
      category,
      tags,
      active,
      metadata,
    });

    if (!document) {
      return res.status(404).json({ message: 'Document not found' });
    }

    res.json(document);
  } catch (error: any) {
    return sendFailure(res, error, 'PUT /api/knowledge/documents/:id');
  }
});

// Delete a document (soft delete)
router.delete('/documents/:id', writeGate, async (req, res) => {
  try {
    const success = await knowledgeService.deleteDocument(parseInt(req.params.id));

    if (!success) {
      return res.status(404).json({ message: 'Document not found' });
    }

    res.json({ message: 'Document deleted successfully' });
  } catch (error: any) {
    return sendFailure(res, error, 'DELETE /api/knowledge/documents/:id');
  }
});

// Search the knowledge base
router.get('/search', async (req, res) => {
  try {
    const query = req.query.q as string;
    const categories = req.query.categories as string | undefined;
    const tags = req.query.tags as string | undefined;
    const limit = parseInt(req.query.limit as string) || 5;

    if (!query) {
      return res.status(400).json({ message: 'Query parameter "q" is required' });
    }

    const results = await knowledgeService.search(query, {
      categories: categories ? categories.split(',') as KnowledgeCategory[] : undefined,
      tags: tags ? tags.split(',') : undefined,
      limit,
    });

    res.json({
      query,
      count: results.length,
      results: results.map(r => ({
        documentId: r.document.id,
        title: r.document.title,
        category: r.document.category,
        relevance: r.relevanceScore,
        snippet: r.snippet,
      })),
    });
  } catch (error: any) {
    return sendFailure(res, error, 'GET /api/knowledge/search');
  }
});

// Get available categories
router.get('/categories', (_req, res) => {
  const categories = [
    { value: 'company', label: 'Company Information' },
    { value: 'services', label: 'Services' },
    { value: 'pricing', label: 'Pricing' },
    { value: 'service_area', label: 'Service Area' },
    { value: 'industry', label: 'Industry Knowledge' },
    { value: 'faq', label: 'FAQ' },
    { value: 'scripts', label: 'Scripts' },
    { value: 'competitors', label: 'Competitors' },
    { value: 'reviews', label: 'Reviews' },
    { value: 'legal', label: 'Legal & Warranty' },
  ];
  res.json(categories);
});

export default router;
