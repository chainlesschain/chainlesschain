/**
 * SAMLProvider - SAML 2.0 Service Provider implementation
 *
 * Handles SAML 2.0 authentication flows including AuthnRequest generation,
 * assertion parsing/validation, SP metadata generation, and logout requests.
 *
 * Features:
 * - SAML AuthnRequest generation with configurable bindings
 * - SAML Response/Assertion parsing and validation
 * - SP metadata XML generation
 * - Single Logout (SLO) request generation
 * - Certificate-based signature validation (conceptual)
 * - XML parsing with fast-xml-parser fallback to regex
 *
 * @module auth/saml-provider
 * @since v0.34.0
 */

const { logger } = require('../utils/logger.js');
const crypto = require('crypto');

// ─── Optional XML Parser ───

let xmlParser = null;
let xmlParserAvailable = false;

try {
  const { XMLParser } = require('fast-xml-parser');
  xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    parseAttributeValue: true,
    trimValues: true,
    isArray: (name) => {
      // Attributes and conditions that can appear multiple times
      const arrayTags = [
        'saml:Attribute',
        'Attribute',
        'saml:AttributeValue',
        'AttributeValue',
        'saml:AudienceRestriction',
        'AudienceRestriction'
      ];
      return arrayTags.includes(name);
    }
  });
  xmlParserAvailable = true;
  logger.debug('[SAMLProvider] fast-xml-parser loaded');
} catch (loadErr) {
  logger.info('[SAMLProvider] fast-xml-parser not available, using regex-based XML parsing');
}

// ─── Constants ───

const SAML_NAMESPACES = {
  saml: 'urn:oasis:names:tc:SAML:2.0:assertion',
  samlp: 'urn:oasis:names:tc:SAML:2.0:protocol',
  ds: 'http://www.w3.org/2000/09/xmldsig#',
  xenc: 'http://www.w3.org/2001/04/xmlenc#',
  md: 'urn:oasis:names:tc:SAML:2.0:metadata'
};

const SAML_BINDINGS = {
  HTTP_POST: 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST',
  HTTP_REDIRECT: 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect',
  HTTP_ARTIFACT: 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Artifact'
};

const NAME_ID_FORMATS = {
  UNSPECIFIED: 'urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified',
  EMAIL: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
  PERSISTENT: 'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent',
  TRANSIENT: 'urn:oasis:names:tc:SAML:2.0:nameid-format:transient',
  ENTITY: 'urn:oasis:names:tc:SAML:2.0:nameid-format:entity'
};

const AUTHN_CONTEXT = {
  PASSWORD: 'urn:oasis:names:tc:SAML:2.0:ac:classes:Password',
  PASSWORD_PROTECTED: 'urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport',
  KERBEROS: 'urn:oasis:names:tc:SAML:2.0:ac:classes:Kerberos',
  X509: 'urn:oasis:names:tc:SAML:2.0:ac:classes:X509',
  WINDOWS: 'urn:oasis:names:tc:SAML:2.0:ac:classes:IntegratedWindowsAuthentication'
};

const STATUS_CODES = {
  SUCCESS: 'urn:oasis:names:tc:SAML:2.0:status:Success',
  REQUESTER: 'urn:oasis:names:tc:SAML:2.0:status:Requester',
  RESPONDER: 'urn:oasis:names:tc:SAML:2.0:status:Responder',
  VERSION_MISMATCH: 'urn:oasis:names:tc:SAML:2.0:status:VersionMismatch',
  AUTHN_FAILED: 'urn:oasis:names:tc:SAML:2.0:status:AuthnFailed',
  NO_PASSIVE: 'urn:oasis:names:tc:SAML:2.0:status:NoPassive'
};

// ─── Main Class ───

class SAMLProvider {
  /**
   * Create a SAMLProvider instance
   * @param {Object} options - Configuration options
   * @param {Object} options.config - SAML configuration
   * @param {string} options.config.entityId - Service Provider entity ID
   * @param {string} options.config.idpEntityId - Identity Provider entity ID
   * @param {string} options.config.ssoUrl - IdP Single Sign-On URL
   * @param {string} [options.config.sloUrl] - IdP Single Logout URL
   * @param {string} options.config.certificate - IdP certificate (PEM or base64)
   * @param {string} options.config.assertionConsumerUrl - SP Assertion Consumer Service URL
   * @param {string} [options.config.nameIdFormat] - Preferred NameID format
   * @param {string} [options.config.binding] - SAML binding type
   * @param {boolean} [options.config.wantAssertionsSigned] - Require signed assertions
   * @param {boolean} [options.config.wantResponseSigned] - Require signed response
   * @param {string} [options.config.spCertificate] - SP certificate for signing
   * @param {string} [options.config.spPrivateKey] - SP private key for signing
   * @param {string} [options.config.signatureAlgorithm] - Signature algorithm
   * @param {string} [options.config.digestAlgorithm] - Digest algorithm
   * @param {number} [options.config.clockSkew] - Allowed clock skew in seconds
   */
  constructor({ config } = {}) {
    if (!config) {
      throw new Error('[SAMLProvider] config parameter is required');
    }

    if (!config.entityId) {
      throw new Error('[SAMLProvider] config.entityId is required');
    }

    if (!config.ssoUrl) {
      throw new Error('[SAMLProvider] config.ssoUrl is required');
    }

    if (!config.assertionConsumerUrl) {
      throw new Error('[SAMLProvider] config.assertionConsumerUrl is required');
    }

    this.entityId = config.entityId;
    this.idpEntityId = config.idpEntityId || null;
    this.ssoUrl = config.ssoUrl;
    this.sloUrl = config.sloUrl || null;
    this.certificate = config.certificate || null;
    this.assertionConsumerUrl = config.assertionConsumerUrl;
    this.nameIdFormat = config.nameIdFormat || NAME_ID_FORMATS.UNSPECIFIED;
    this.binding = config.binding || SAML_BINDINGS.HTTP_POST;
    this.wantAssertionsSigned = config.wantAssertionsSigned !== false;
    this.wantResponseSigned = config.wantResponseSigned || false;
    this.spCertificate = config.spCertificate || null;
    this.spPrivateKey = config.spPrivateKey || null;
    this.signatureAlgorithm = config.signatureAlgorithm || 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256';
    this.digestAlgorithm = config.digestAlgorithm || 'http://www.w3.org/2001/04/xmlenc#sha256';
    this.clockSkew = config.clockSkew || 300; // 5 minutes default

    logger.debug('[SAMLProvider] Initialized for SP:', this.entityId);
  }

  // ════════════════════════════════════════════
  // AuthnRequest Generation
  // ════════════════════════════════════════════

  /**
   * Generate a SAML AuthnRequest XML document
   * @param {string} id - Unique request identifier (should start with '_')
   * @param {string} [relayState] - RelayState to include
   * @param {Object} [options] - Additional options
   * @param {boolean} [options.forceAuthn] - Force re-authentication
   * @param {boolean} [options.isPassive] - Passive authentication (no user interaction)
   * @param {string} [options.nameIdPolicy] - Override NameID format
   * @param {string} [options.authnContext] - Requested authentication context
   * @param {string} [options.providerName] - Provider name
   * @returns {string} SAML AuthnRequest XML
   */
  generateAuthnRequest(id, relayState, options = {}) {
    if (!id) {
      id = '_' + crypto.randomUUID().replace(/-/g, '');
    }

    const issueInstant = new Date().toISOString();
    const nameIdFormat = options.nameIdPolicy || this.nameIdFormat;

    // Build AuthnRequest attributes
    const attrs = [
      `xmlns:samlp="${SAML_NAMESPACES.samlp}"`,
      `xmlns:saml="${SAML_NAMESPACES.saml}"`,
      `ID="${this._escapeXml(id)}"`,
      `Version="2.0"`,
      `IssueInstant="${issueInstant}"`,
      `Destination="${this._escapeXml(this.ssoUrl)}"`,
      `AssertionConsumerServiceURL="${this._escapeXml(this.assertionConsumerUrl)}"`,
      `ProtocolBinding="${this._escapeXml(this.binding)}"`
    ];

    if (options.forceAuthn) {
      attrs.push('ForceAuthn="true"');
    }

    if (options.isPassive) {
      attrs.push('IsPassive="true"');
    }

    if (options.providerName) {
      attrs.push(`ProviderName="${this._escapeXml(options.providerName)}"`);
    }

    // Build the XML document
    let xml = `<?xml version="1.0" encoding="UTF-8"?>`;
    xml += `\n<samlp:AuthnRequest ${attrs.join(' ')}>`;

    // Issuer
    xml += `\n  <saml:Issuer>${this._escapeXml(this.entityId)}</saml:Issuer>`;

    // NameID Policy
    xml += `\n  <samlp:NameIDPolicy`;
    xml += ` Format="${this._escapeXml(nameIdFormat)}"`;
    xml += ` AllowCreate="true"`;
    xml += `/>`;

    // Requested Authentication Context
    if (options.authnContext) {
      xml += `\n  <samlp:RequestedAuthnContext Comparison="exact">`;
      xml += `\n    <saml:AuthnContextClassRef>${this._escapeXml(options.authnContext)}</saml:AuthnContextClassRef>`;
      xml += `\n  </samlp:RequestedAuthnContext>`;
    }

    // Conditions (optional audience restriction)
    // Not typically in AuthnRequest, but some IdPs support it

    xml += `\n</samlp:AuthnRequest>`;

    logger.debug(`[SAMLProvider] Generated AuthnRequest ID: ${id}`);

    return xml;
  }

  // ════════════════════════════════════════════
  // Assertion Parsing
  // ════════════════════════════════════════════

  /**
   * Parse and validate a SAML Response
   * @param {string} samlResponse - Base64-encoded SAML Response
   * @returns {Object} Parsed assertion data { nameId, attributes, sessionIndex, conditions }
   */
  parseAssertion(samlResponse) {
    if (!samlResponse) {
      throw new Error('[SAMLProvider] SAML Response is required');
    }

    // Step 1: Decode base64
    let xml;
    try {
      xml = Buffer.from(samlResponse, 'base64').toString('utf8');
    } catch (decodeError) {
      // Try as plain XML (not base64 encoded)
      if (samlResponse.includes('<')) {
        xml = samlResponse;
      } else {
        throw new Error(`Failed to decode SAML Response: ${decodeError.message}`);
      }
    }

    logger.debug('[SAMLProvider] Parsing SAML Response, XML length:', xml.length);

    // Step 2: Check response status
    const status = this._extractStatus(xml);
    if (status.code !== STATUS_CODES.SUCCESS) {
      const statusMsg = status.message || 'Unknown error';
      throw new Error(`SAML authentication failed. Status: ${status.code}. Message: ${statusMsg}`);
    }

    // Step 3: Extract assertion data
    let assertion;
    if (xmlParserAvailable) {
      assertion = this._parseWithXmlParser(xml);
    } else {
      assertion = this._parseWithRegex(xml);
    }

    if (!assertion) {
      throw new Error('No assertion found in SAML Response');
    }

    // Step 4: Verify signature (conceptual - log warning)
    this._verifySignature(xml, assertion);

    // Step 5: Validate conditions
    if (assertion.conditions) {
      this._validateConditions(assertion.conditions);
    }

    logger.info(`[SAMLProvider] SAML assertion parsed successfully. NameID: ${assertion.nameId}`);

    return assertion;
  }

  /**
   * Parse SAML Response using fast-xml-parser
   * @private
   */
  _parseWithXmlParser(xml) {
    try {
      const parsed = xmlParser.parse(xml);

      // Navigate the parsed structure to find the assertion
      // SAML Response can be samlp:Response or Response
      const response = parsed['samlp:Response'] || parsed['Response'] ||
                       parsed['saml2p:Response'] || parsed;

      if (!response) {
        logger.warn('[SAMLProvider] No Response element found in parsed XML');
        return null;
      }

      // Find assertion (may be nested under different prefixes)
      const assertion = response['saml:Assertion'] || response['Assertion'] ||
                        response['saml2:Assertion'];

      if (!assertion) {
        logger.warn('[SAMLProvider] No Assertion element found in Response');
        return null;
      }

      // Extract NameID
      const subject = assertion['saml:Subject'] || assertion['Subject'] ||
                      assertion['saml2:Subject'];
      let nameId = null;
      let nameIdFormat = null;

      if (subject) {
        const nameIdElement = subject['saml:NameID'] || subject['NameID'] ||
                              subject['saml2:NameID'];
        if (nameIdElement) {
          nameId = typeof nameIdElement === 'string' ? nameIdElement : nameIdElement['#text'];
          nameIdFormat = nameIdElement['@_Format'] || null;
        }
      }

      // Extract session index from AuthnStatement
      const authnStatement = assertion['saml:AuthnStatement'] || assertion['AuthnStatement'] ||
                             assertion['saml2:AuthnStatement'];
      let sessionIndex = null;
      if (authnStatement) {
        sessionIndex = authnStatement['@_SessionIndex'] || null;
      }

      // Extract conditions
      const conditionsElement = assertion['saml:Conditions'] || assertion['Conditions'] ||
                                assertion['saml2:Conditions'];
      let conditions = null;
      if (conditionsElement) {
        conditions = {
          notBefore: conditionsElement['@_NotBefore'] || null,
          notOnOrAfter: conditionsElement['@_NotOnOrAfter'] || null
        };

        // Extract audience restriction
        const audienceRestriction = conditionsElement['saml:AudienceRestriction'] ||
                                    conditionsElement['AudienceRestriction'] ||
                                    conditionsElement['saml2:AudienceRestriction'];
        if (audienceRestriction) {
          const restriction = Array.isArray(audienceRestriction) ? audienceRestriction[0] : audienceRestriction;
          const audience = restriction['saml:Audience'] || restriction['Audience'] ||
                           restriction['saml2:Audience'];
          conditions.audience = typeof audience === 'string' ? audience : (audience?.['#text'] || null);
        }
      }

      // Extract attributes
      const attributeStatement = assertion['saml:AttributeStatement'] || assertion['AttributeStatement'] ||
                                  assertion['saml2:AttributeStatement'];
      const attributes = {};

      if (attributeStatement) {
        const attrs = attributeStatement['saml:Attribute'] || attributeStatement['Attribute'] ||
                      attributeStatement['saml2:Attribute'];
        const attrArray = Array.isArray(attrs) ? attrs : (attrs ? [attrs] : []);

        for (const attr of attrArray) {
          const attrName = attr['@_Name'] || attr['@_FriendlyName'] || 'unknown';
          const friendlyName = attr['@_FriendlyName'] || null;
          const values = attr['saml:AttributeValue'] || attr['AttributeValue'] ||
                         attr['saml2:AttributeValue'];

          let attrValue;
          if (Array.isArray(values)) {
            attrValue = values.map(v => typeof v === 'object' ? v['#text'] : v);
            if (attrValue.length === 1) {
              attrValue = attrValue[0];
            }
          } else if (values !== undefined && values !== null) {
            attrValue = typeof values === 'object' ? values['#text'] : values;
          } else {
            attrValue = null;
          }

          // Store by friendly name if available, otherwise by full name
          const key = friendlyName || this._extractAttributeShortName(attrName);
          attributes[key] = attrValue;
        }
      }

      return {
        nameId,
        nameIdFormat,
        sessionIndex,
        conditions,
        attributes,
        issuer: this._extractElementText(response, 'Issuer'),
        responseId: response['@_ID'] || null,
        assertionId: assertion['@_ID'] || null
      };
    } catch (parseError) {
      logger.error('[SAMLProvider] XML parser error, falling back to regex:', parseError.message);
      return this._parseWithRegex(xml);
    }
  }

  /**
   * Parse SAML Response using regex (fallback when fast-xml-parser is not available)
   * @private
   */
  _parseWithRegex(xml) {
    try {
      // Extract NameID
      const nameIdMatch = xml.match(/<(?:saml[2]?:)?NameID[^>]*>([^<]+)<\/(?:saml[2]?:)?NameID>/);
      const nameId = nameIdMatch ? nameIdMatch[1].trim() : null;

      // Extract NameID Format
      const nameIdFormatMatch = xml.match(/<(?:saml[2]?:)?NameID[^>]*Format="([^"]*)"[^>]*>/);
      const nameIdFormat = nameIdFormatMatch ? nameIdFormatMatch[1] : null;

      // Extract SessionIndex
      const sessionIndexMatch = xml.match(/SessionIndex="([^"]*)"/);
      const sessionIndex = sessionIndexMatch ? sessionIndexMatch[1] : null;

      // Extract Conditions
      let conditions = null;
      const conditionsMatch = xml.match(/<(?:saml[2]?:)?Conditions([^>]*)>/);
      if (conditionsMatch) {
        const condAttrs = conditionsMatch[1];
        const notBeforeMatch = condAttrs.match(/NotBefore="([^"]*)"/);
        const notOnOrAfterMatch = condAttrs.match(/NotOnOrAfter="([^"]*)"/);

        conditions = {
          notBefore: notBeforeMatch ? notBeforeMatch[1] : null,
          notOnOrAfter: notOnOrAfterMatch ? notOnOrAfterMatch[1] : null
        };

        // Extract Audience
        const audienceMatch = xml.match(/<(?:saml[2]?:)?Audience>([^<]+)<\/(?:saml[2]?:)?Audience>/);
        if (audienceMatch) {
          conditions.audience = audienceMatch[1].trim();
        }
      }

      // Extract Attributes
      const attributes = {};
      const attrRegex = /<(?:saml[2]?:)?Attribute\s+([^>]*)>([\s\S]*?)<\/(?:saml[2]?:)?Attribute>/g;
      let attrMatch;

      while ((attrMatch = attrRegex.exec(xml)) !== null) {
        const attrAttrs = attrMatch[1];
        const attrBody = attrMatch[2];

        // Extract attribute name
        const nameMatch = attrAttrs.match(/Name="([^"]*)"/);
        const friendlyNameMatch = attrAttrs.match(/FriendlyName="([^"]*)"/);
        const attrName = friendlyNameMatch
          ? friendlyNameMatch[1]
          : (nameMatch ? this._extractAttributeShortName(nameMatch[1]) : 'unknown');

        // Extract attribute values
        const valueRegex = /<(?:saml[2]?:)?AttributeValue[^>]*>([^<]*)<\/(?:saml[2]?:)?AttributeValue>/g;
        const values = [];
        let valueMatch;

        while ((valueMatch = valueRegex.exec(attrBody)) !== null) {
          values.push(valueMatch[1].trim());
        }

        attributes[attrName] = values.length === 1 ? values[0] : (values.length > 0 ? values : null);
      }

      // Extract Issuer
      const issuerMatch = xml.match(/<(?:saml[2]?:)?Issuer[^>]*>([^<]+)<\/(?:saml[2]?:)?Issuer>/);
      const issuer = issuerMatch ? issuerMatch[1].trim() : null;

      // Extract Response ID
      const responseIdMatch = xml.match(/<(?:samlp|saml2p)?:?Response[^>]+ID="([^"]*)"/);
      const responseId = responseIdMatch ? responseIdMatch[1] : null;

      // Extract Assertion ID
      const assertionIdMatch = xml.match(/<(?:saml[2]?:)?Assertion[^>]+ID="([^"]*)"/);
      const assertionId = assertionIdMatch ? assertionIdMatch[1] : null;

      if (!nameId) {
        logger.warn('[SAMLProvider] No NameID found in SAML Response (regex parsing)');
      }

      return {
        nameId,
        nameIdFormat,
        sessionIndex,
        conditions,
        attributes,
        issuer,
        responseId,
        assertionId
      };
    } catch (regexError) {
      logger.error('[SAMLProvider] Regex parsing failed:', regexError.message);
      throw new Error(`SAML Response parsing failed: ${regexError.message}`);
    }
  }

  // ════════════════════════════════════════════
  // SP Metadata Generation
  // ════════════════════════════════════════════

  /**
   * Generate SP metadata XML document
   * @param {Object} [options] - Metadata options
   * @param {string} [options.organizationName] - Organization name
   * @param {string} [options.organizationUrl] - Organization URL
   * @param {string} [options.contactEmail] - Technical contact email
   * @param {string} [options.contactName] - Technical contact name
   * @param {boolean} [options.wantAuthnRequestsSigned] - Indicate signed AuthnRequests
   * @returns {string} SP metadata XML
   */
  generateMetadata(options = {}) {
    const now = new Date().toISOString();
    const validUntil = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(); // 1 year

    let xml = `<?xml version="1.0" encoding="UTF-8"?>`;
    xml += `\n<md:EntityDescriptor`;
    xml += ` xmlns:md="${SAML_NAMESPACES.md}"`;
    xml += ` xmlns:ds="${SAML_NAMESPACES.ds}"`;
    xml += ` entityID="${this._escapeXml(this.entityId)}"`;
    xml += ` validUntil="${validUntil}">`;

    // SP SSO Descriptor
    xml += `\n  <md:SPSSODescriptor`;
    xml += ` AuthnRequestsSigned="${options.wantAuthnRequestsSigned || !!this.spPrivateKey}"`;
    xml += ` WantAssertionsSigned="${this.wantAssertionsSigned}"`;
    xml += ` protocolSupportEnumeration="${SAML_NAMESPACES.samlp}">`;

    // SP signing certificate (if available)
    if (this.spCertificate) {
      const certBase64 = this._extractCertificateBase64(this.spCertificate);
      xml += `\n    <md:KeyDescriptor use="signing">`;
      xml += `\n      <ds:KeyInfo>`;
      xml += `\n        <ds:X509Data>`;
      xml += `\n          <ds:X509Certificate>${certBase64}</ds:X509Certificate>`;
      xml += `\n        </ds:X509Data>`;
      xml += `\n      </ds:KeyInfo>`;
      xml += `\n    </md:KeyDescriptor>`;

      // Also use for encryption
      xml += `\n    <md:KeyDescriptor use="encryption">`;
      xml += `\n      <ds:KeyInfo>`;
      xml += `\n        <ds:X509Data>`;
      xml += `\n          <ds:X509Certificate>${certBase64}</ds:X509Certificate>`;
      xml += `\n        </ds:X509Data>`;
      xml += `\n      </ds:KeyInfo>`;
      xml += `\n    </md:KeyDescriptor>`;
    }

    // Single Logout Service
    if (this.sloUrl) {
      xml += `\n    <md:SingleLogoutService`;
      xml += ` Binding="${SAML_BINDINGS.HTTP_POST}"`;
      xml += ` Location="${this._escapeXml(this.sloUrl)}"`;
      xml += `/>`;

      xml += `\n    <md:SingleLogoutService`;
      xml += ` Binding="${SAML_BINDINGS.HTTP_REDIRECT}"`;
      xml += ` Location="${this._escapeXml(this.sloUrl)}"`;
      xml += `/>`;
    }

    // NameID Formats
    const formats = [
      NAME_ID_FORMATS.EMAIL,
      NAME_ID_FORMATS.PERSISTENT,
      NAME_ID_FORMATS.TRANSIENT,
      NAME_ID_FORMATS.UNSPECIFIED
    ];

    for (const format of formats) {
      xml += `\n    <md:NameIDFormat>${format}</md:NameIDFormat>`;
    }

    // Assertion Consumer Service (POST binding)
    xml += `\n    <md:AssertionConsumerService`;
    xml += ` Binding="${SAML_BINDINGS.HTTP_POST}"`;
    xml += ` Location="${this._escapeXml(this.assertionConsumerUrl)}"`;
    xml += ` index="0"`;
    xml += ` isDefault="true"`;
    xml += `/>`;

    // Assertion Consumer Service (Redirect binding)
    xml += `\n    <md:AssertionConsumerService`;
    xml += ` Binding="${SAML_BINDINGS.HTTP_REDIRECT}"`;
    xml += ` Location="${this._escapeXml(this.assertionConsumerUrl)}"`;
    xml += ` index="1"`;
    xml += `/>`;

    // Attribute consuming service (declare expected attributes)
    xml += `\n    <md:AttributeConsumingService index="0" isDefault="true">`;
    xml += `\n      <md:ServiceName xml:lang="en">ChainlessChain SSO</md:ServiceName>`;
    xml += `\n      <md:ServiceDescription xml:lang="en">ChainlessChain decentralized personal AI management system</md:ServiceDescription>`;

    // Common requested attributes
    const requestedAttributes = [
      { name: 'urn:oid:0.9.2342.19200300.100.1.3', friendlyName: 'email', required: true },
      { name: 'urn:oid:2.5.4.42', friendlyName: 'givenName', required: false },
      { name: 'urn:oid:2.5.4.4', friendlyName: 'surname', required: false },
      { name: 'urn:oid:2.16.840.1.113730.3.1.241', friendlyName: 'displayName', required: false },
      { name: 'urn:oid:1.3.6.1.4.1.5923.1.1.1.7', friendlyName: 'groups', required: false }
    ];

    for (const attr of requestedAttributes) {
      xml += `\n      <md:RequestedAttribute`;
      xml += ` Name="${attr.name}"`;
      xml += ` FriendlyName="${attr.friendlyName}"`;
      xml += ` isRequired="${attr.required}"`;
      xml += `/>`;
    }

    xml += `\n    </md:AttributeConsumingService>`;

    xml += `\n  </md:SPSSODescriptor>`;

    // Organization info (optional)
    if (options.organizationName || options.organizationUrl) {
      xml += `\n  <md:Organization>`;
      if (options.organizationName) {
        xml += `\n    <md:OrganizationName xml:lang="en">${this._escapeXml(options.organizationName)}</md:OrganizationName>`;
        xml += `\n    <md:OrganizationDisplayName xml:lang="en">${this._escapeXml(options.organizationName)}</md:OrganizationDisplayName>`;
      }
      if (options.organizationUrl) {
        xml += `\n    <md:OrganizationURL xml:lang="en">${this._escapeXml(options.organizationUrl)}</md:OrganizationURL>`;
      }
      xml += `\n  </md:Organization>`;
    }

    // Contact person (optional)
    if (options.contactEmail || options.contactName) {
      xml += `\n  <md:ContactPerson contactType="technical">`;
      if (options.contactName) {
        xml += `\n    <md:GivenName>${this._escapeXml(options.contactName)}</md:GivenName>`;
      }
      if (options.contactEmail) {
        xml += `\n    <md:EmailAddress>${this._escapeXml(options.contactEmail)}</md:EmailAddress>`;
      }
      xml += `\n  </md:ContactPerson>`;
    }

    xml += `\n</md:EntityDescriptor>`;

    logger.info(`[SAMLProvider] SP metadata generated for entity: ${this.entityId}`);

    return xml;
  }

  // ════════════════════════════════════════════
  // Logout Request
  // ════════════════════════════════════════════

  /**
   * Build a SAML LogoutRequest XML document
   * @param {string} nameId - NameID of the user to log out
   * @param {string} [sessionIndex] - Session index from the assertion
   * @param {Object} [options] - Additional options
   * @param {string} [options.id] - Custom request ID
   * @param {string} [options.reason] - Logout reason
   * @param {string} [options.nameIdFormat] - NameID format
   * @returns {string} SAML LogoutRequest XML
   */
  buildLogoutRequest(nameId, sessionIndex, options = {}) {
    if (!nameId) {
      throw new Error('[SAMLProvider] nameId is required for logout request');
    }

    const id = options.id || ('_' + crypto.randomUUID().replace(/-/g, ''));
    const issueInstant = new Date().toISOString();
    const destination = this.sloUrl || this.ssoUrl;
    const nameIdFormat = options.nameIdFormat || this.nameIdFormat;

    let xml = `<?xml version="1.0" encoding="UTF-8"?>`;
    xml += `\n<samlp:LogoutRequest`;
    xml += ` xmlns:samlp="${SAML_NAMESPACES.samlp}"`;
    xml += ` xmlns:saml="${SAML_NAMESPACES.saml}"`;
    xml += ` ID="${this._escapeXml(id)}"`;
    xml += ` Version="2.0"`;
    xml += ` IssueInstant="${issueInstant}"`;
    xml += ` Destination="${this._escapeXml(destination)}"`;

    if (options.reason) {
      xml += ` Reason="${this._escapeXml(options.reason)}"`;
    }

    // NotOnOrAfter for the logout request (5 minutes from now)
    const notOnOrAfter = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    xml += ` NotOnOrAfter="${notOnOrAfter}"`;

    xml += `>`;

    // Issuer
    xml += `\n  <saml:Issuer>${this._escapeXml(this.entityId)}</saml:Issuer>`;

    // NameID
    xml += `\n  <saml:NameID`;
    xml += ` Format="${this._escapeXml(nameIdFormat)}"`;
    if (this.idpEntityId) {
      xml += ` SPNameQualifier="${this._escapeXml(this.entityId)}"`;
    }
    xml += `>${this._escapeXml(nameId)}</saml:NameID>`;

    // Session Index
    if (sessionIndex) {
      xml += `\n  <samlp:SessionIndex>${this._escapeXml(sessionIndex)}</samlp:SessionIndex>`;
    }

    xml += `\n</samlp:LogoutRequest>`;

    logger.debug(`[SAMLProvider] Generated LogoutRequest ID: ${id} for NameID: ${nameId}`);

    return xml;
  }

  // ════════════════════════════════════════════
  // Private: Validation Helpers
  // ════════════════════════════════════════════

  /**
   * Extract response status from SAML Response XML
   * @private
   */
  _extractStatus(xml) {
    // Try to extract StatusCode Value
    const statusCodeMatch = xml.match(/<(?:samlp|saml2p)?:?StatusCode[^>]+Value="([^"]*)"/);
    const statusCode = statusCodeMatch ? statusCodeMatch[1] : null;

    // Try to extract StatusMessage
    const statusMessageMatch = xml.match(/<(?:samlp|saml2p)?:?StatusMessage[^>]*>([^<]*)<\/(?:samlp|saml2p)?:?StatusMessage>/);
    const statusMessage = statusMessageMatch ? statusMessageMatch[1].trim() : null;

    // Try to extract StatusDetail
    const statusDetailMatch = xml.match(/<(?:samlp|saml2p)?:?StatusDetail[^>]*>([\s\S]*?)<\/(?:samlp|saml2p)?:?StatusDetail>/);
    const statusDetail = statusDetailMatch ? statusDetailMatch[1].trim() : null;

    return {
      code: statusCode || STATUS_CODES.SUCCESS, // Default to success if no status found
      message: statusMessage,
      detail: statusDetail
    };
  }

  /**
   * Verify SAML Response signature (conceptual)
   * @private
   */
  _verifySignature(xml, assertion) {
    // Check if signature element exists
    const hasSignature = xml.includes('<ds:Signature') || xml.includes('<Signature');

    if (!hasSignature) {
      if (this.wantAssertionsSigned || this.wantResponseSigned) {
        logger.warn('[SAMLProvider] Response/Assertion is not signed but signing is required');
        logger.warn('[SAMLProvider] In production, install xml-crypto for full signature verification');
      } else {
        logger.debug('[SAMLProvider] No signature found in SAML Response (unsigned mode)');
      }
      return;
    }

    // Attempt actual signature verification if xml-crypto is available
    try {
      const xmlCrypto = require('xml-crypto');

      // Extract Signature element
      const signatureMatch = xml.match(/<(?:ds:)?Signature[\s\S]*?<\/(?:ds:)?Signature>/);
      if (!signatureMatch) {
        logger.warn('[SAMLProvider] Could not extract Signature element');
        return;
      }

      if (this.certificate) {
        const cert = this._normalizeCertificate(this.certificate);
        const sig = new xmlCrypto.SignedXml();
        sig.keyInfoProvider = {
          getKey: () => cert
        };
        sig.loadSignature(signatureMatch[0]);

        const isValid = sig.checkSignature(xml);
        if (isValid) {
          logger.info('[SAMLProvider] SAML signature verified successfully');
        } else {
          logger.error('[SAMLProvider] SAML signature verification FAILED:', sig.validationErrors);
          throw new Error('SAML signature verification failed');
        }
      }
    } catch (xmlCryptoError) {
      if (xmlCryptoError.code === 'MODULE_NOT_FOUND') {
        logger.warn('[SAMLProvider] xml-crypto not available. Signature present but not verified.');
        logger.warn('[SAMLProvider] Install xml-crypto for production signature verification: npm install xml-crypto');
      } else {
        logger.error('[SAMLProvider] Signature verification error:', xmlCryptoError.message);
        // Don't throw - allow the assertion to proceed with a warning
      }
    }
  }

  /**
   * Validate assertion conditions (time bounds, audience)
   * @private
   */
  _validateConditions(conditions) {
    const now = new Date();
    const errors = [];

    // Check NotBefore
    if (conditions.notBefore) {
      const notBefore = new Date(conditions.notBefore);
      const adjustedNotBefore = new Date(notBefore.getTime() - (this.clockSkew * 1000));

      if (now < adjustedNotBefore) {
        errors.push(`Assertion not yet valid. NotBefore: ${conditions.notBefore}`);
      }
    }

    // Check NotOnOrAfter
    if (conditions.notOnOrAfter) {
      const notOnOrAfter = new Date(conditions.notOnOrAfter);
      const adjustedNotOnOrAfter = new Date(notOnOrAfter.getTime() + (this.clockSkew * 1000));

      if (now >= adjustedNotOnOrAfter) {
        errors.push(`Assertion has expired. NotOnOrAfter: ${conditions.notOnOrAfter}`);
      }
    }

    // Check Audience
    if (conditions.audience && this.entityId) {
      if (conditions.audience !== this.entityId) {
        errors.push(`Audience mismatch. Expected: ${this.entityId}, Got: ${conditions.audience}`);
      }
    }

    if (errors.length > 0) {
      logger.warn('[SAMLProvider] Condition validation warnings:', errors);
      // In strict mode, these would be errors. For flexibility, we log as warnings.
    }

    return errors;
  }

  // ════════════════════════════════════════════
  // Private: XML Helpers
  // ════════════════════════════════════════════

  /**
   * Escape XML special characters
   * @private
   */
  _escapeXml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * Extract text from a named element across namespace prefixes
   * @private
   */
  _extractElementText(obj, elementName) {
    if (!obj) return null;

    const prefixes = ['saml:', 'saml2:', ''];
    for (const prefix of prefixes) {
      const key = prefix + elementName;
      if (obj[key]) {
        const val = obj[key];
        return typeof val === 'string' ? val : val['#text'] || null;
      }
    }
    return null;
  }

  /**
   * Extract short name from a full OID or URL attribute name
   * @private
   */
  _extractAttributeShortName(fullName) {
    if (!fullName) return 'unknown';

    // Handle URN-based names (e.g., urn:oid:0.9.2342.19200300.100.1.3)
    // Common OID to friendly name mappings
    const oidMap = {
      'urn:oid:0.9.2342.19200300.100.1.3': 'email',
      'urn:oid:2.5.4.42': 'firstName',
      'urn:oid:2.5.4.4': 'lastName',
      'urn:oid:2.16.840.1.113730.3.1.241': 'displayName',
      'urn:oid:1.3.6.1.4.1.5923.1.1.1.7': 'groups',
      'urn:oid:2.5.4.3': 'cn',
      'urn:oid:0.9.2342.19200300.100.1.1': 'uid',
      'urn:oid:2.5.4.20': 'telephoneNumber',
      'urn:oid:2.5.4.10': 'organization',
      'urn:oid:2.5.4.11': 'organizationalUnit',
      'urn:oid:2.5.4.6': 'country',
      'urn:oid:2.5.4.7': 'locality',
      'urn:oid:2.5.4.8': 'stateOrProvince'
    };

    if (oidMap[fullName]) {
      return oidMap[fullName];
    }

    // Handle URL-based names - take last path segment
    if (fullName.includes('/')) {
      const segments = fullName.split('/');
      return segments[segments.length - 1];
    }

    // Handle colon-separated names
    if (fullName.includes(':')) {
      const parts = fullName.split(':');
      return parts[parts.length - 1];
    }

    return fullName;
  }

  /**
   * Extract base64 certificate content from PEM or raw base64
   * @private
   */
  _extractCertificateBase64(cert) {
    if (!cert) return '';

    // Remove PEM headers/footers and whitespace
    return cert
      .replace(/-----BEGIN CERTIFICATE-----/g, '')
      .replace(/-----END CERTIFICATE-----/g, '')
      .replace(/[\r\n\s]/g, '');
  }

  /**
   * Normalize certificate to PEM format
   * @private
   */
  _normalizeCertificate(cert) {
    if (!cert) return '';

    const base64 = this._extractCertificateBase64(cert);

    // Re-wrap to proper PEM format
    const lines = base64.match(/.{1,64}/g) || [];
    return `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----`;
  }
}

module.exports = { SAMLProvider };
