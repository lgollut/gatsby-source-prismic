import * as R from 'ramda'
import pascalcase from 'pascalcase'

const IMAGE_FIELD_KEYS = ['dimensions', 'alt', 'copyright', 'url', 'localFile']

// Returns a GraphQL type name given a field based on its type. If the type is
// is an object or union, the necessary type definition is enqueued on to the
// provided queue to be created at a later time.
const fieldToType = (id, value, depth, context) => {
  const {
    customTypeId,
    enqueueTypeDef,
    enqueueTypePath,
    gatsbyContext,
  } = context
  const { schema: gatsbySchema, createNodeId } = gatsbyContext

  switch (value.type) {
    case 'UID':
      enqueueTypePath([...depth, id], 'String')
      return {
        type: 'String',
        description:
          "The document's unique identifier. Unique among all instances of the document's type.",
      }

    case 'Color':
    case 'Select':
    case 'Text':
      enqueueTypePath([...depth, id], 'String')
      return 'String'

    case 'StructuredText':
      enqueueTypePath([...depth, id], 'PrismicStructuredTextType')
      return 'PrismicStructuredTextType'

    case 'Number':
      enqueueTypePath([...depth, id], 'Float')
      return 'Float'

    case 'Date':
    case 'Timestamp':
      enqueueTypePath([...depth, id], 'Date')
      return 'Date'

    case 'GeoPoint':
      enqueueTypePath([...depth, id], 'PrismicGeoPointType')
      return 'PrismicGeoPointType'

    case 'Embed':
      enqueueTypePath([...depth, id], 'PrismicEmbedType')
      return 'PrismicEmbedType'

    case 'Image':
      enqueueTypePath([...depth, id], 'PrismicImageType')
      return {
        type: 'PrismicImageType',
        resolve: (parent, args, context, info) => {
          const key = info.path.key
          const value = parent[key]

          const getFileNode = id =>
            context.nodeModel.getNodeById({
              id,
              type: 'File',
            })

          const baseValue = R.compose(
            R.assoc('localFile', getFileNode(value.localFile)),
            R.pick(IMAGE_FIELD_KEYS),
          )(value)

          const thumbValues = R.compose(
            R.mapObjIndexed(v =>
              R.assoc('localFile', getFileNode(v.localFile), v),
            ),
            R.omit(IMAGE_FIELD_KEYS),
          )(value)

          return {
            ...baseValue,
            ...thumbValues,
          }
        },
      }

    case 'Link':
      enqueueTypePath([...depth, id], 'PrismicLinkType')
      return {
        type: 'PrismicLinkType',
        resolve: (parent, args, context, info) => {
          const key = info.path.key
          const value = parent[key]

          return {
            ...value,
            document: context.nodeModel.getNodeById({
              id: createNodeId(`${value.type} ${value.id}`),
              type: pascalcase(`Prismic ${value.type}`),
            }),
          }
        },
      }

    case 'Group':
      const groupName = pascalcase(`Prismic ${customTypeId} ${id} Group Type`)
      const subfields = value.config.fields

      enqueueTypeDef(
        gatsbySchema.buildObjectType({
          name: groupName,
          fields: R.mapObjIndexed(
            (subfield, subfieldId) =>
              fieldToType(subfieldId, subfield, [...depth, id], context),
            subfields,
          ),
        }),
      )

      enqueueTypePath([...depth, id], `[${groupName}]`)

      return `[${groupName}]`

    case 'Slice':
      const { sliceZoneId } = context
      const { 'non-repeat': primaryFields, repeat: itemsFields } = value

      const sliceFields = {
        id: 'String',
        slice_type: 'String',
      }

      if (primaryFields && !R.isEmpty(primaryFields)) {
        const primaryName = pascalcase(
          `Prismic ${customTypeId} ${sliceZoneId} ${id} Primary Type`,
        )

        enqueueTypeDef(
          gatsbySchema.buildObjectType({
            name: primaryName,
            fields: R.mapObjIndexed(
              (primaryField, primaryFieldId) =>
                fieldToType(
                  primaryFieldId,
                  primaryField,
                  [...depth, id, 'primary'],
                  context,
                ),
              primaryFields,
            ),
          }),
        )

        enqueueTypePath([...depth, id, 'primary'], primaryName)

        sliceFields.primary = `${primaryName}`
      }

      if (itemsFields && !R.isEmpty(itemsFields)) {
        const itemName = pascalcase(
          `Prismic ${customTypeId} ${sliceZoneId} ${id} Item Type`,
        )

        enqueueTypeDef(
          gatsbySchema.buildObjectType({
            name: itemName,
            fields: R.mapObjIndexed(
              (itemField, itemFieldId) =>
                fieldToType(
                  itemFieldId,
                  itemField,
                  [...depth, id, 'items'],
                  context,
                ),
              itemsFields,
            ),
          }),
        )

        enqueueTypePath([...depth, id, 'items'], `[${itemName}]`)

        sliceFields.items = `[${itemName}]`
      }

      const sliceName = pascalcase(
        `Prismic ${customTypeId} ${sliceZoneId} ${id}`,
      )

      enqueueTypeDef(
        gatsbySchema.buildObjectType({
          name: sliceName,
          fields: sliceFields,
          interfaces: ['Node'],
        }),
      )

      enqueueTypePath([...depth, id], sliceName)

      return sliceName

    case 'Slices':
      const choiceTypes = R.compose(
        R.values,
        R.mapObjIndexed((choice, choiceId) =>
          fieldToType(choiceId, choice, [...depth, id], {
            ...context,
            sliceZoneId: id,
          }),
        ),
      )(value.config.choices)

      const slicesName = pascalcase(`Prismic ${customTypeId} ${id} Slices Type`)

      enqueueTypeDef(
        gatsbySchema.buildUnionType({
          name: slicesName,
          types: choiceTypes,
        }),
      )

      enqueueTypePath([...depth, id], `[${slicesName}]`)

      return {
        type: `[${slicesName}]`,
        resolve: (parent, args, context, info) =>
          context.nodeModel.getNodesByIds({
            ids: parent[info.path.key],
          }),
      }

    case 'IntegrationFields':
      enqueueTypePath([...depth, id], 'PrismicIntegrationFields')
      return 'PrismicIntegrationFields'

    default:
      console.log(`UNPROCESSED FIELD for type "${value.type}"`, id)
      return null
  }
}

export const generateTypeDefsForCustomType = (id, json, context) => {
  const { gatsbyContext } = context
  const { schema: gatsbySchema } = gatsbyContext

  const typeDefs = []
  const enqueueTypeDef = typeDef => typeDefs.push(typeDef)

  const typePaths = []
  const enqueueTypePath = (path, type) => typePaths.push({ path, type })

  // UID fields are defined at the same level as data fields, but are a level
  // about data in API responses. Pulling it out separately here allows us to
  // process the UID field differently than the data fields.
  const { uid: uidField, ...dataFields } = R.compose(
    R.mergeAll,
    R.values,
  )(json)

  // UID fields must be conditionally processed since not all custom types
  // implement a UID field.
  let uidFieldType
  if (uidField)
    uidFieldType = fieldToType('uid', uidField, [id], {
      ...context,
      customTypeId: id,
      enqueueTypePath,
    })

  const dataFieldTypes = R.mapObjIndexed(
    (field, fieldId) =>
      fieldToType(fieldId, field, [id, 'data'], {
        ...context,
        customTypeId: id,
        enqueueTypeDef,
        enqueueTypePath,
      }),
    dataFields,
  )

  const dataName = pascalcase(`Prismic ${id} Data Type`)

  enqueueTypePath([id, 'data'], dataName)

  enqueueTypeDef(
    gatsbySchema.buildObjectType({
      name: dataName,
      fields: dataFieldTypes,
    }),
  )

  const customTypeName = pascalcase(`Prismic ${id}`)
  const customTypeFields = {
    data: { type: dataName, description: "The document's data fields." },
    dataRaw: {
      type: 'JSON!',
      description:
        "The document's data object without transformations exactly as it comes from the Prismic API.",
    },
    dataString: {
      type: 'String!',
      description:
        "The document's data object without transformations. The object is stringified via `JSON.stringify` to eliminate the need to declare subfields.",
      deprecationReason: 'Use `dataRaw` instead which returns JSON.',
    },
    first_publication_date: {
      type: 'Date!',
      description: "The document's initial publication date.",
    },
    href: {
      type: 'String!',
      description: "The document's URL derived via the link resolver.",
    },
    id: {
      type: 'ID!',
      description:
        'Globally unique identifier. Note that this differs from the `prismicID` field.',
    },
    lang: { type: 'String!', description: "The document's language." },
    last_publication_date: {
      type: 'Date!',
      description: "The document's most recent publication date",
    },
    tags: { type: '[String!]!', description: "The document's list of tags." },
    type: {
      type: 'String!',
      description: "The document's Prismic API ID type.",
    },
    prismicId: { type: 'ID!', description: "The document's Prismic ID." },
  }
  if (uidFieldType) customTypeFields.uid = uidFieldType

  enqueueTypePath([id], customTypeName)

  enqueueTypeDef(
    gatsbySchema.buildObjectType({
      name: customTypeName,
      fields: customTypeFields,
      interfaces: ['PrismicDocument', 'Node'],
    }),
  )

  return { typeDefs, typePaths }
}

export const generateTypeDefForLinkType = (allTypeDefs, context) => {
  const { gatsbyContext } = context
  const { schema: gatsbySchema } = gatsbyContext

  const documentTypeNames = R.compose(
    R.map(R.path(['config', 'name'])),
    R.filter(
      R.compose(
        R.contains('PrismicDocument'),
        R.pathOr([], ['config', 'interfaces']),
      ),
    ),
  )(allTypeDefs)

  return gatsbySchema.buildUnionType({
    name: 'PrismicAllDocumentTypes',
    types: documentTypeNames,
  })
}
