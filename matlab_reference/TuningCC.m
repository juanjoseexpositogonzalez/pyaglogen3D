function varargout = TuningCC( varargin )
    %% Variables de entrada
    rng( 'shuffle' );
    if nargin == 7
        nop = varargin{ 1 };
        dop = varargin{ 2 };
        solape = varargin{ 3 };
        kf = varargin{ 4 };
        Df = varargin{ 5 };
        semilla = varargin{ 6 };
        max_rotaciones = varargin{ 7 };
    elseif nargin == 6
        nop = varargin{ 1 };
        dop = varargin{ 2 };
        solape = varargin{ 3 };
        kf = varargin{ 4 };
        Df = varargin{ 5 };
        semilla = varargin{ 6 };
        max_rotaciones = 25;
    elseif nargin == 5
        nop = varargin{ 1 };
        dop = varargin{ 2 };
        solape = varargin{ 3 };
        kf = varargin{ 4 };
        Df = varargin{ 5 };
        semilla = 4;
        max_rotaciones = 25;    
    elseif nargin == 4
        nop = varargin{ 1 };
        dop = varargin{ 2 };
        solape = varargin{ 3 };
        kf = varargin{ 4 };
        Df = unifrnd( 1, 3, 1, 1 );
        semilla = 4;
        max_rotaciones = 25;
    elseif nargin == 3
        nop = varargin{ 1 };
        dop = varargin{ 2 };
        solape = varargin{ 3 };
        kf = unifrnd( 1.1, 1.7, 1, 1 );
        Df = unifrnd( 1, 3, 1, 1 );
        semilla = 4;
        max_rotaciones = 25;
    elseif nargin == 2
        nop = varargin{ 1 };
        dop = varargin{ 2 };
        solape = normrnd( 1, 1.4, nop, 1 );
        kf = unifrnd( 1.1, 1.7, 1, 1 );
        Df = unifrnd( 1, 3, 1, 1 );
        semilla = 4;
        max_rotaciones = 25;
    elseif nargin == 1
        nop = varargin{ 1 };
        dop = normrnd( 25, 4.5, nop, 1 );
        solape = normrnd( 1.3, 0.15, nop, 1 );
        kf = unifrnd( 1.1, 1.7, 1, 1 );
        Df = unifrnd( 1, 3, 1, 1 );
        semilla = 4;
        max_rotaciones = 25;
   elseif nargin == 0
        nop = randi( [ 6 200 ] );
        dop = normrnd( 25, 4.5, nop, 1 );
        solape = normrnd( 1.3, 0.15, nop, 1 );
        kf = unifrnd( 1.1, 1.7, 1, 1 );
        Df = unifrnd( 1, 3, 1, 1 );  
        semilla = 4;
        max_rotaciones = 25;
    end    

    % Determinar si hay que aleatorizar alguna variable
    if iscell( nop )
        switch( lower( nop{ 3 } ) )
            case 'uniform'
                nop = randi( [ nop{ 1 } nop{ 2 } ] );
            case 'normal'
                nop = ceil( normrnd( nop{ 1 }, nop{ 2 }, 1, 1 ) );
            otherwise
                msg = [ 'Distribution ', nop{ 3 }, ' not implemented yet!' ];
                error( msg );
        end
    end

    if iscell( dop )
        switch( lower( dop{ 3 } ) )
            case 'uniform'
                dop = unifrnd( dop{ 1 }, dop{ 2 }, nop, 1 );
            case 'normal'
                dop = normrnd( dop{ 1 }, dop{ 2 }, nop, 1 );
            otherwise
                msg = [ 'Distribution ', dop{ 3 }, ' not implemented yet!' ];
                error( msg );
        end
    elseif ( numel( dop ) == 1 )
        dop = dop * ones( nop, 1 );
    end

    if iscell( solape )
        switch( lower( solape{ 3 } ) )
            case 'uniform'
                solape = unifrnd( solape{ 1 }, solape{ 2 }, nop, 1 );
            case 'normal'
                solape = normrnd( solape{ 1 }, solape{ 2 }, nop, 1 );
            otherwise
                msg = [ 'Distribution ', solape{ 3 }, ' not implemented yet!' ];
                error( msg );
        end
    end

    if iscell( kf )
        switch( lower( kf{ 3 } ) )
            case 'uniform'
                kf = randiunifrnd( kf{ 1 }, kf{ 2 }, 1, 1 );
            case 'normal'
                kf = ceil( normrnd( kf{ 1 }, kf{ 2 }, 1, 1 ) );
            otherwise
                msg = [ 'Distribution ', kf{ 3 }, ' not implemented yet!' ];
                error( msg );
        end
    end
    
    if iscell( Df )
        switch( lower( Df{ 3 } ) )
            case 'uniform'
                Df = randiunifrnd( Df{ 1 }, Df{ 2 }, 1, 1 );
            case 'normal'
                Df = ceil( normrnd( Df{ 1 }, Df{ 2 }, 1, 1 ) );
            otherwise
                msg = [ 'Distribution ', Df{ 3 }, ' not implemented yet!' ];
                error( msg );
        end
    end
        
    %% Inicialización de variables
    % Almacen inicial de clusters
    clusters    = cell( nop, 1 );
    referencias = cell( nop, 1 );

    % Inicialmente todos los clusters están compuestos por monómeros
    for s = 1 : nop
        % Estructura de datos: numero de clúster, número de particula dentro del cluster, coordenadas x, y, z y radio
        cluster = [ s 1 0 0 0 dop( s, 1 ) / 2 ];
        % Estructura de datos: numero de clúster, coordenadas x, y, z de su centro de geométrico y de gravedad, 
        % radio de la esfera envolvente, radio de giro
        centros = { s [ 0 0 0 dop( s, 1 ) / 2 ; ...                 % Centro geométrico y radio de la esfera que circunscribe
                        0 0 0 sqrt( 3 / 5 ) * dop( 1, 1 ) / 2 ] };  % Centro de gravedad y radio de giro
        clusters{ s, 1 } = cluster;
        referencias{ s, 1 } = centros;
    end
    intentos = zeros( nop, 1 );
    deltas = zeros( nop, 1 );
    total_rot = zeros( nop, 1 );
    constante = 3/5;                % 3/5 para Lapuerta et al, 0 para Filipov
    
    %% Preparación de los cluster semilla
    numClusters = floor( nop / semilla );
    restoPart = mod( nop, semilla );
    clusters = cell( numClusters + ( restoPart > 0 ), 1 );
    referencias = cell( numClusters + ( restoPart > 0 ), 1 );
    for ss = 1 : numClusters
        [ cluster, referencia, ~, ~, ~ ] = agloGen3D( semilla, mean( dop ), mean( solape ), 'PC' );
        part = cell2mat( cluster );
        part( :, 1 ) = ss;
        clusters{ ss, 1 } = part;        
        referencias{ ss } = { ss referencia{ 1 }{ 2 } };                             
    end
    
    % Hay que unir las particulas sueltas (siempre harán un cluster con un npo menor que la semilla dada)
    if ( restoPart ~= 0 && restoPart > 1 )
        [ cluster, referencia, ~, ~, ~ ] = agloGen3D( restoPart, mean( dop ), mean( solape ), 'CC' );
        part = cell2mat( cluster );
        part( :, 1 ) = ss + 1;
        clusters{ ss + 1, 1 } = part;        
        referencias{ ss + 1 } = { ss + 1 referencia{ 1 }{ 2 } };
    elseif ( restoPart == 1 )
        part = cell2mat( cluster );
        part( :, 1 ) = ss + 1;
        clusters{ ss + 1, 1 } = part;
        referencias{ ss + 1 } = { ss + 1 [ 0 0 0 dop( end ) / 2; 0 0 0 3 / 10 * dop( end ) ] };
    end
    
    %% Comienzo del algoritmo
    
    while ( numel( clusters ) > 1 )
        % Definimos una variable que lleva el control de si ha habido choque o no
        choque = 0;

        % Hasta que no haya un choque fructífero no dejamos de ejecutar el siguiente bloque de código
        while( ~choque )
            % 1. Sorteo de los monómeros a intervenir en el choque.
            [ impactado, impactante ] = sorteoClusteres( clusters, 'CC' );
            % 1.1. Extraemos los clústers impactado e impactante y los centros geométricos de ambos
            cGeomImpactado = referencias{ impactado }{ 2 }( 1, 1 : 3 );
            cGeomImpactante = referencias{ impactante }{ 2 }( 1, 1 : 3 );
            % 1.2. Necesitamos el radio de la esfera que circunscribe al aglomerado impactante
            radioImpactante = mean( clusters{ impactante }( :, end ) );
            radioImpactado = mean( clusters{ impactado }( :, end ) );
            % rgImpactante = referencias{ impactante }{ 2 }( 2, 4 );
            % rgImpactado = referencias{ impactado }{ 2 }( 2, 4 );
            rEnvolImpactado = referencias{ impactado }{ 2 }( 1, 4 );
            rEnvolImpactante = referencias{ impactante }{ 2 }( 1, 4 );
            impactado = clusters{ impactado };
            impactante = clusters{ impactante };
            dpo = radioImpactante + radioImpactado;
            
            % Calculo de la distancia a la que tienen que situarse los clusters
            npo1 = size( impactado, 1 );
            npo2 = size( impactante, 1 );
            gamma = distanciaClusters( npo1, npo2, dpo, constante, kf, Df );
            
            % Comprobar que se cumple la condicion necesaria para que haya colision
            if ( ( rEnvolImpactado + rEnvolImpactante ) < ( gamma / 2 ) )
                continue;   % Salimos del bucle sin realizar el choque y volvemos a sortear
            end % if ( ( rEnvolImpactado + rEnvolImpactante ) < gamma / 2 )
            
            % Reposicionamos los clusters (uno en el origen el impactado y otro a una distancia
            % gamma
            
            % Determinamos aleatoriamente los ángulos
            [ ~, ~, a, b, c ] = determineAngles( 1 );
            distancia = gamma * [ a b c ];
            % Trasladamos las coordenadas pertintentes: las coordenadas de las particulas del impactante
            impactante( :, 3 : 5 ) = desplazarCoordenadas( impactante( :, 3 : 5 ), distancia );
            % El centro geometrico del impactado se desplazara para que coincida con el punto [ 0 0 0 ]
            impactado( :, 3 : 5 ) = desplazarCoordenadas( impactado( :, 3 : 5 ), -cGeomImpactado );
            % Los centros geometricos han de desplazarse tambien
            cGeomImpactante = desplazarCoordenadas( cGeomImpactante, distancia );
            cGeomImpactado = desplazarCoordenadas( cGeomImpactado, -cGeomImpactado );
            
            % Generamos las listas de las partículas que pueden intersectar
            LB1 = find( sqrt( sum( impactado( :, 3 : 5 ) .^ 2 - repmat( cGeomImpactado, npo1, 1 ) .^ 2, 2 ) ) > ...
                repmat( ( gamma - rEnvolImpactante ), npo1, 1 ) - impactado( :, end ) > 0, 1 );
            LB2 = find( sqrt( sum( impactante( :, 3 : 5 ) .^ 2 - repmat( cGeomImpactante, npo2, 1 ) .^ 2, 2 ) ) > ...
                repmat( ( gamma - rEnvolImpactado ), npo2, 1 ) - impactante( :, end ) > 0, 1 );  
            
            % Comprobamos que al menos haya dos particulas (una de cada conjunto) para poder colisionar
            if ( isempty( LB1 ) || isempty ( LB2 ) )
                continue;   % Salir del bucle y volver a sortear  
            end
            
            % Seleccionamos al azar dos particulas, una de cada conjunto
            B1 = LB1( randi( [ 1 numel( LB1 ) ] ) );
            B2 = LB2( randi( [ 1 numel( LB2 ) ] ) );
            % Generamos el producto cartesiano de los dos conjuntos anteriores
            C = allcomb( B1, B2 );
            % Seleccionamos un par de particulas al azar
            C1 = C( randi( [ 1 numel( C ) ] ) );
            
            % Hay que comprobar todos los pares
            while ( numel( C ) > 0 )                
                % Comprobamos que se puede alcanzar una configuracion estable con el aglomerado resultante
                % El primer elemento referencia a una del impactado, el segundo a una del impactante
                if ~( norm( impactado( C( 1 ), 3 : 5 )  ) + norm( impactante( C( 2 ), 3 : 5 ) - cGeomImpactante ) + ...
                    impactado( C( 1 ), 6 ) + impactante( C( 2 ), 6 ) >= gamma )
                    % Salimos el bucle, el par seleccionado no genera un aglomerado nuevo
                    % Eliminamos el par que no genera posible colision                    
                    C = setdiff( C, C1 );
                    % Antes seleccionamos otro par al azar
                    C1 = C( randi( [ 1 numel( C ) ] ) );
                    continue;
                end % if
                
                % Calculo de los angulos de giro
                % Angulo g, primero calculamos g_plus y g luego restamos ambos
                C1P1 = norm( impactado( C( 1 ), 3 : 5 ) );
                C1C2 = gamma;
                C2P2 = norm( impactante( C( 2 ), 3 : 5 ) );
                g_plus = acos( ( C1P1 ^ 2 + C1C2 ^ 2 - C2P2 ^ 2 ) / ( 2 * C1P1 * C1C2 ) );
                C2P1 = norm( impactado( C( 1 ), 3 :5 ) - cGeomImpactante );
                g = acos( ( C1P1 ^ 2 + C1C2 ^ 2 - C2P1 ^ 2 ) / ( 2 * C1P1 * C1C2 ) );
                g = g - g_plus;
                
                % Giro
                C1P1 = impactado( C( 1 ), 3 : 5 );
                C1C2 = distancia;
                Giro = cross( C1C2, C1P1 );
                
                % Construccion del cuaternio para rotar el vector
                Giro = Giro / norm( Giro );
                Qg = [ cos( g / 2 ) Giro * sin( g / 2 ) ];
                Qg_conj = conjugar_cuaternio( Qg );
                
                % Giramos el aglomerado impactado (vectorizar siguiente código)
                for tt = 1 : npo1
                    rotado = multiplica_cuaternion( Qg, [ 0 impactado( tt, 3 : 5 ) ] );
                    rotado = multiplica_cuaternion( rotado, Qg_conj );
                    impactado( tt, 3 : 5 ) = rotado( 2 : end );
                end
                
                % Calculo de los angulos para girar el aglomerado impactante
                C2CM1 = norm( cGeomImpactante - impactado( C( 1 ), 3 : 5 ) );
                C2CM2 = norm( impactante( C( 2 ), 3 : 5 ) );
                CM1CM2 = norm( impactado( C( 1 ), 3 : 5 ) - impactante( C( 2 ), 3 : 5 ) );
                Cm1Cm2 = impactado( C( 1 ), 6 ) + impactado( C( 2 ), 6 );
                d = acos( C2CM1 ^ 2 + C2CM2 ^ 2 - CM1CM2 ^ 2 ) / ( 2 * C2CM1 + C2CM2 );
                d_plus = acos( C2CM1 ^ 2 + C2CM2 ^ 2 - Cm1Cm2 ^ 2 ) / ( 2 * C2CM1 + C2CM2 );
                d = d - d_plus;
                
                % Giro para el impactante
                C2CM1 = cGeomImpactante - impactado( C( 1 ), 3 : 5 );
                C2CM2 = impactante( C( 2 ), 3 : 5 );
                Giro2 = cross( C2CM1, C2CM2 );
                % Construccion del cuaternio para rotar el vector
                Giro2 = Giro2 / norm( Giro );
                Qd = [ cos( d / 2 ) Giro2 * sin( d / 2 ) ];
                Qd_conj = conjugar_cuaternio( Qd );
                
                % Giramos el aglomerado impactante (vectorizar siguiente código)
                for tt = 1 : npo2
                    rotado = multiplica_cuaternion( Qd, [ 0 impactante( tt, 3 : 5 ) ] );
                    rotado = multiplica_cuaternion( rotado, Qd_conj );
                    impactante( tt, 3 : 5 ) = rotado( 2 : end );
                end
                
                
            end % while ( numel( C1 ) > 0 )
            
            
        end % while ( ~choque )
        
    end % while ( numel( clusters ) > 1 )   
    
    
    %% Asignacion variables de salida
    varargout{ 1, 1 } = clusters;
    varargout{ 2, 1 } = referencias;
    varargout{ 3, 1 } = intentos;
    varargout{ 4, 1 } = deltas;
    varargout{ 5, 1 } = total_rot;
    varargout{ 6, 1 } = solape;
    varargout{ 7, 1 } = kf;
    varargout{ 8, 1 } = Df;
end % function TuningCC