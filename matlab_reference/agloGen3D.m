function [ clusters, referencias, intentos, vec, deltas ] = agloGen3D( varargin )
% ----------------------------------------------------------------------------------------------------------------------
% [ part, vec, rog, eS ] = agloGen3D( varargin )
% Genera Aglomerado 3D aleatorios con geometría cuasi-fractal partiendo utilizando dos métodos para los
% impactos : partícula-clúster (PC) o clúster-clúster (CC)
%
% Argumentos de entrada:
% varargin: Listado de argumentos de entrada. Puede tener hasta un máximo de cuatro entradas diferentes:
%           nop--> Número de monómeros que constituyen el aglomerado a construir. Puede ser un número fijo o
%           ser determinado aleatoriamente dentro de un rango
%           dop--> Diámetro de los monómeros. Si se introduce un valor se construirá un aglomerado
%           monodisperso, si se introduce un intervalo se asignará aleatoriamente a cada monómero un diámetro
%           dentro del rango.
%           solape--> Si se introduce un valor se asignará el mismo solape para cada par de partículas
%           vecinas. Si se introduce un rango, se asignará un solape aleatorio dentro del rango. Si no se
%           introduce ningún valor, se supondrá que no hay solape.
%           method--> Método de creación de aglomerados. Puede ser partícula-clúster (PC), clúster-clúster
%           (CC) o Tunable (T) donde el usuario elige la dimension fractal y el prefactor.
%
%
% Argumentos de salida:
% clusters:     Celda con las desplazamientos X, Y, Z de las coordenadas de los monómeros con respecto al centro
%               geométrico del aglomerado y el diámetro de cada monómero del aglomerado
% referencias:  Celdas con las coordenadas del centro geométrico del aglomerado, el radio de la esfera que
%               circunscribe a dicho aglomerado
% intentos:     Intentos de choque infructuosos
% vec:          Matriz dispersa con los monómeros que son vecinos
% deltas:       Vector con los coeficientes de solape entre particulas vecinas
%
% ----------------------------------------------------------------------------------------------------------------------

    %% Comprobacion de los parámetros de entrada y asignación de variables
    if nargin == 4
        nop = varargin{ 1 };
        dop = varargin{ 2 };
        solape = varargin{ 3 };
        method = varargin{ 4 };    
    elseif nargin == 3
        nop = str2double( varargin{ 1 } );
        dop = str2double( varargin{ 2 } );
        solape = str2double( varargin{ 3 } );
        prompt = { 'Enter method of aggregation: PC, CC, T' } ;
        name = 'Method of Aggregation';
        numlines = 1;
        defaultanswer = { 'PC' };
        method = inputdlg( prompt, name, numlines, defaultanswer );
        method = method { : };
        clear prompt name numlines defaultanswer
    elseif nargin == 2
        nop = str2double( varargin{ 1 } );
        dop = str2double( varargin{ 2 } );
        prompt = { 'Input sintering coefficient (1-1.3). -1 for random sintering coefficient' };
        name = 'Sintering';
        numlines = 1;
        defaultanswer = { '1' };
        solape = inputdlg( prompt, name, numlines, defaultanswer );
        solape = str2double( solape );
        if ( solape == 0 )
            solape = {};
            prompt = { 'Enter range for sintering between particles' };
            name   = 'Minimum sintering coefficient';
            numlines = 1;
            defaultanswer = { '1' };
            solape{ 1 } = inputdlg( prompt, name, numlines, defaultanswer );
            solape1 = str2double( solape{ 1 } );
            prompt = { 'Enter range for diameter of particles' };
            name   = 'Maximum sintering coefficient';
            numlines = 1;
            defaultanswer = { 'Inf' };
            solape{ 2 } = inputdlg( prompt, name, numlines, defaultanswer );
            solape2 = str2double( solape{ 2 } );
            solape = [ solape1 solape2 ];
        end
        prompt = { 'Enter method of aggregation: PC, CC or T' } ;
        name = 'Method of Aggregation';
        numlines = 1;
        defaultanswer = { 'PC' };
        method = inputdlg( prompt, name, numlines, defaultanswer );
        method = method{ : };
        clear prompt name numlines defaultanswer
    elseif nargin == 1
        nop = str2double( varargin{ 1 } );
         % Diámetro de las partículas
        prompt = { 'Enter diameter of particles. Enter 0 for random' };
        name   = 'Input diameter of particles';
        numlines = 1;
        defaultanswer = { '0' };
        dop = inputdlg( prompt, name, numlines, defaultanswer );
        dop = str2double( dop );
        if ( dop == 0 )
            dop = {};
            prompt = { 'Enter range for diameter of particles' };
            name   = 'Minimum particle diameter.';
            numlines = 1;
            defaultanswer = { '25' };
            dop{ 1 } = inputdlg( prompt, name, numlines, defaultanswer );
            dop1 = str2double( dop{ 1 } );
            prompt = { 'Enter range for diameter of particles' };
            name   = 'Maximum particle diameter';
            numlines = 1;
            defaultanswer = { '40' };
            dop{ 2 } = inputdlg( prompt, name, numlines, defaultanswer );
            dop2 = str2double( dop{ 2 } );
            dop = [ dop1 dop2 ];
        end
        prompt = { 'Input sintering coefficient (1-1.3). -1 for random sintering coefficient' };
        name = 'Sintering';
        numlines = 1;
        defaultanswer = { '1' };
        solape = inputdlg( prompt, name, numlines, defaultanswer );
        solape = str2double( solape );
        if ( solape == 0 )
            solape = {};
            prompt = { 'Enter range for sintering between particles' };
            name   = 'Minimum sintering coefficient';
            numlines = 1;
            defaultanswer = { '1' };
            solape{ 1 } = inputdlg( prompt, name, numlines, defaultanswer );
            solape1 = str2double( solape{ 1 } );
            prompt = { 'Enter range for diameter of particles' };
            name   = 'Maximum sintering coefficient';
            numlines = 1;
            defaultanswer = { 'Inf' };
            solape{ 2 } = inputdlg( prompt, name, numlines, defaultanswer );
            solape2 = str2double( solape{ 2 } );
            solape = [ solape1 solape2 ];
        end
        prompt = { 'Enter method of aggregation: PC, CC or T' } ;
        name = 'Method of Aggregation';
        numlines = 1;
        defaultanswer = { 'PC' };
        method = inputdlg( prompt, name, numlines, defaultanswer );
        method = method{ : };
        clear prompt name numlines defaultanswer
    elseif nargin == 0
        prompt = { 'Enter number of particles. Enter 0 for random' };
        name   = 'Input number of particles';
        numlines = 1;
        defaultanswer = { '0' };
        nop = inputdlg( prompt, name, numlines, defaultanswer );
        nop = str2double( nop );
        % Si se introduce cero, se tiene que dar el rango
        if ( nop == 0 )
            % Mínimo
            nop = {};
            prompt = { 'Enter range for number of particles' };
            name   = 'Minimum number of particles:';
            numlines = 1;
            defaultanswer = { '6' };
            nop{ 1 } = inputdlg( prompt, name, numlines, defaultanswer );
            nop1 = str2double( nop{ 1 } );
            % Máximo
            prompt = { 'Enter range for number of particles' };
            name   = 'Maximum number of particles';
            numlines = 1;
            defaultanswer = { '200' };
            nop{ 2 } = inputdlg( prompt, name, numlines, defaultanswer );
            nop2 = str2double( nop{ 2 } );
            nop = [ nop1 nop2 ];
        end        
        % Diámetro de las particulas
        prompt = { 'Enter diameter of particles. Enter 0 for random' };
        name   = 'Input diameter of particles';
        numlines = 1;
        defaultanswer = { '0' };
        dop = inputdlg( prompt, name, numlines, defaultanswer );
        dop = str2double( dop );
        if ( dop == 0 )
            dop = {};
            prompt = { 'Enter range for diameter of particles' };
            name   = 'Minimum particle diameter.';
            numlines = 1;
            defaultanswer = { '25' };
            dop{ 1 } = inputdlg( prompt, name, numlines, defaultanswer );
            dop1 = str2double( dop{ 1 } );
            prompt = { 'Enter range for diameter of particles' };
            name   = 'Maximum particle diameter';
            numlines = 1;
            defaultanswer = { '40' };
            dop{ 2 } = inputdlg( prompt, name, numlines, defaultanswer );
            dop2 = str2double( dop{ 2 } );
            dop = [ dop1 dop2 ];
        end
        prompt = { 'Input sintering coefficient (1-1.3). Enter "Uniform"|"Normal" to select the distribution' };
        name = 'Sintering';
        numlines = 1;
        defaultanswer = { '1' };
        solape = inputdlg( prompt, name, numlines, defaultanswer );
        solape = str2double( solape );
        if ( solape == 0 )
            solape = {};
            prompt = { 'Enter range for sintering between particles' };
            name   = 'Minimum sintering coefficient';
            numlines = 1;
            defaultanswer = { '1' };
            solape{ 1 } = inputdlg( prompt, name, numlines, defaultanswer );
            solape1 = str2double( solape{ 1 } );
            prompt = { 'Enter range for diameter of particles' };
            name   = 'Maximum sintering coefficient';
            numlines = 1;
            defaultanswer = { 'Inf' };
            solape{ 2 } = inputdlg( prompt, name, numlines, defaultanswer );
            solape2 = str2double( solape{ 2 } );
            solape = [ solape1 solape2 ];
        end
        prompt = { 'Enter method of aggregation: PC, CC or T' } ;
        name = 'Method of Aggregation';
        numlines = 1;
        defaultanswer = { 'PC' };
        method = inputdlg( prompt, name, numlines, defaultanswer );
        method = method{ : };
        clear prompt name numlines defaultanswer s varargin
    end
    maxSolape = sqrt( 3 );

    %% Comprobacion de los argumentos de entrada. 
    if iscell( nop )
        if ( numel( nop ) < 1 || numel ( nop ) > 3 )
            msg = 'Incorrect input for number of particles';
            error( msg );
        else
            if ( nop{ 1 } < 0 || nop{ 2 } < 0 ) 
                msg = 'Number of particles must be positive';
                error( msg );
            else
                if strcmpi( nop{ 3 }, 'uniform' )
                    if ( nop{ 1 } > nop{ 2 } )
                        msg = 'Range of number of particles must be increasing';
                        error( msg );
                    end
                else
                    if ( nop{ 1 } - nop{ 2 } ) < 0
                        msg = 'Minimum number of random particles cannot be negative';
                        error( msg );
                    end
                end
            end
        end
    else % Se ha utilizado un numero concreto de partículas
        if ( numel( nop ) ~= 1 || nop < 0 )
            msg = 'Incorrect input for deterministic number of particules';
            error( msg );
        end
    end

    if iscell( dop )        
        if ( numel( dop ) < 1 || numel ( dop ) > 3 )
            msg = 'Incorrect input for diameter of particles';
            error( msg );
        else
            if ( ( dop{ 1 } < 0 ) || ( dop{ 2 } < 0 ) )
                msg = 'Diameter of particles must be positive';
                error( msg );
            else
                if strcmpi(  dop{ 3 } , 'uniform' )
                    if ( dop{ 1 } > dop{ 2 } )
                        msg = 'Range of diameter for particles must be increasing';
                        error( msg );
                    end
                else
                    if ( ( dop{ 1 } - dop{ 2 } ) < 0 )
                        msg = 'No random value to be generated must be negative';
                        error( msg );
                    end
                end
            end
        end        
    else
        if ( numel( dop ) ~= 1 || dop < 0 )
            msg = 'Incorrect input for deterministic diameter of particules';
            error( msg );
        end        
    end
    
    if iscell( solape )
        if ( numel( solape ) < 1 || numel( solape ) > 3 )
            msg = 'Incorrect input for sintering coefficient';
            error( msg );
        else
            if ( solape{ 1 } < 1 )
                msg = 'Sintering coefficient must be greater or equal than one';
                error( msg );
            else
                if ( solape{ 2 } > maxSolape )
                    msg = [ 'Sintering coefficiente must be lower than ' num2str( maxSolape ) ];
                    error( msg );
                else
                    if strcmpi( solape{ 3 }, 'uniform' )
                        if ( solape{ 1 } > solape{ 2 } )
                            msg = 'Range for sintering coefficient must be increasing';
                            error( msg );
                        else
                            if ( solape{ 1 } - solape{ 2 } < 1 )
                                msg = 'Minimum random sintering cannot be less than 1';
                                error( msg );
                            end
                        end
                    end
                end
            end
        end
    else
        if ( numel( solape ) ~= 1 )
            msg = 'Incorrect input for deterministic sintering of particules';
            error( msg );
        end   
    end
    
    if ( ~strcmpi( method, 'PC' ) &&  ~strcmpi( method, 'CC' ) &&  ~strcmpi( method, 'T' ) )
        msg = 'Error in method: Input PP for particle-particle, PC for particle-cluster or T for Tunable';
        error( msg );
    end

    %% Iniciación de variables
    if iscell( nop )
        distribution = nop{ 3 };    % Distribution
        switch(lower(distribution))
            case 'uniform'
                rng( 'shuffle' );   
                nop = randi( [ nop{ 1 }, nop{ 2 } ] );        
            case 'normal'
                rng( 'shuffle' );
                nop = ceil( normrnd( nop{ 1 }, nop{ 2 } ) );
        end
    end
    % Number of particles initialization
    if iscell( dop )
        distribution = dop{ 3 };
        switch lower( distribution )
            case 'uniform'
                rng( 'shuffle' );
                dop2 = zeros( nop, 1 );
                for s = 1 : nop
                    dop2( s, 1 ) = randi( [ dop{ 1 }, dop{ 2 } ] );
                end
                dop = dop2;
                clear dop2;            
            case 'normal'
                rng( 'shuffle' );
                dop2 = zeros( nop, 1 );
                for s = 1 : nop
                    dop2( s, 1 ) = normrnd( dop{ 1 }, dop{ 2 } );
                end
                dop = dop2;
                clear dop2;                 
        end
    else
        dop = dop * ones( nop, 1 );
    end
    
    if iscell( solape )
        distribution = solape{ 3 };
        switch lower( distribution )
            case 'uniform'
                deltas = solape( 1 ) + ( solape( 2 ) - solape( 1 ) ) .* rand( nop, 1 );
            case 'normal'
                deltas = zeros( nop, 1 );
                for s = 1 : nop
                    deltas( s, 1 ) = normrnd( solape{ 1 }, solape{ 2 } );
                end
        end
    else
        deltas = solape * ones( nop, 1 );
    end
    
    intentos = 0;

    %% Reservar espacio para las variables de salida

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

    %% AQUÍ EMPIEZA EL MÉTODO DE CREACIÓN DE AGLOMERADOS PROPIAMENTE DICHO
    % Determinamos las direcciones aleatorias de impacto para cada uno de los clústeres que han de chocar
    [ ~, ~, alpha, beta, gamma ] = determineAngles( nop );
    s = 1 ; % Variable que toma los valores de 1 hasta nop

    % El algoritmo calcula choques hasta que sólo queda un elemento en clústers: el aglomerado final
    while( numel( clusters ) > 1 )    
        % Definimos una variable que lleva el control de si ha habido choque o no
        choque = 0;

        % Hasta que no haya un choque fructífero no dejamos de ejecutar el siguiente bloque de código
        while( ~choque )

            % 1. Sorteo de los monómeros a intervenir en el choque.
            [ impactado, impactante ] = sorteoClusteres( clusters, method );
            % 1.1. Extraemos los clústers impactado e impactante y los centros geométricos de ambos
            cGeomImpactado = referencias{ impactado }{ 2 }( 1, 1 : 3 );
            cGeomImpactante = referencias{ impactante }{ 2 }( 1, 1 : 3 );
            % 1.2. Necesitamos el radio de la esfera que circunscribe al aglomerado impactante
            radioImpactante = referencias{ impactante }{ 2 }( 1, 4 ) ;
            radioImpactado = referencias{ impactado }{ 2 }( 1, 4 );
            impactado = clusters{ impactado };
            impactante = clusters{ impactante };

            % 2. Colocar al monómero impactado en el centro de coordenadas global
            impactado = posicionarCluster( impactado, cGeomImpactado );

            % 3. Determinar punto focal inicial en la dirección [ 0 0 0 ] con v
            v = [ alpha( s, 1 ) beta( s, 1 ) gamma( s, 1 ) ];
            fP = 2 * ( radioImpactante + radioImpactado ) * v;

            % 4. Determinar punto aleatorio dentro de la aureola del impactado
            iP = getRandomPoint( clusters, impactado( 1 ), radioImpactante );
            % 4.2. Corregir el punto focal por el desplazamiento del punto de impacto desde el centro del
            % aglomerado impactado al punto iP, determinando antes el vector w que une iP con el [ 0, 0, 0 ]
            w = iP;
            fP = fP + w;

            % 5. Posicionar el cluster impactante en el punto focal
            % 5.1. Determinar el vector de desplazamiento
            w = fP - cGeomImpactante;
            % 5.2. Movemos el impactante al punto focal definitivo
            impactante = posicionarCluster( impactante, -w ); 

            % 6. Antes de irnos a calcular el impacto, debemos hacer una criba para determinar posibles candidatos
            % para el choque. Para ello calculamos las distancias mínimas entre los centros geométricos de los
            % monómeros de los clústeres impactado e impactante y las comparamos con la suma de sus radios
            criba = hacerCriba( impactante, impactado, v, deltas( s, 1 ) );

            % 7. Recorremos los elementos de la criba y vemos cuál es la mínima distancia. El resultado es que
            % tenemos los dos monómeros, tanto del impactante como del impactado que van a intervenir en la
            % colisión y que van a impactar
            distancias = [];
            if ( ~isempty( criba ) )   % Porque puede que no haya impacto alguno
                for m = 1 : size( criba, 1 ) % Monómeros del impactante
                    % Reservamos espacio para un vector fila con tantas filas como monómeros impactados
                    % por el monómero m-ésimo haya determinado la criba. Hay una columna extra para el
                    % índice del monómero impactante
                    % Reservamos espacio para un vector fila con tantas filas como monómeros impactados
                    % por el monómero m-ésimo haya determinado la criba. Hay una columna extra para el
                    % índice del monómero impactante
                    temporal = zeros( 1, 1 + numel( criba{ m, 2 } ) );
                    for n = 1 : numel( criba{ m, 2 } ) % Monómeros del impactado
                    distancia = ...
                        calcularChoque( impactado( criba{ m, 2 }( n ), : ), impactante( criba{ m, 1 }, 6 ) * 2, ...
                        v, impactante( criba { m, 1 }, 3 : 5 ), deltas( s, 1 ) );
                        % Almacenamos el índice del monómero impactante dentro de su clúster
                        temporal( m, 1 ) = criba{ m, 1 };
                        % Calculamos cuánto ha de desplazarse la partícula impactante para impactar en el
                        % clúster impactado
                        if ( ~isempty( distancia ) )
                            temporal( m, n + 1 ) = norm( impactante( criba{ m, 1 }, 3 : 5 ) - distancia ); 
                        else
                            temporal( m, n + 1 ) = Inf;
                        end
                     end  % for para los impactados 
                     % Calculamos el mínimo de las distancias del monómero m-ésimo del impactante a los 
                     % n-monómeros del impactado
                     [ d, idx ] = min( temporal( m, 2 : end ) );
                     % Actualizamos la matriz de distancias
                     distancias = [ distancias; idx d ]; %#ok<AGROW>
                end % for para los impactantes        
                choque = 1;
                % Los monómeros que entran en el choque se determinan a partir de la matriz
                % distancias. Primero calculamos el mínimo de dichas distancias, donde indice nos da 
                % el número de monómero en el impactante
                [ ~, indice ] = min( distancias( :, 2 ) );
                % Ahora de la matriz distancias sacamos cuánto hay que desplazar las coordenadas del impactante
                offset = distancias( indice, 2 );
                % Desplazamos los monomeros del impactante en la cantidad que dada por offset
                impactante = desplazarCoordenadas( impactante, -offset * v );
            else
                intentos = intentos + 1;            
            end % if ( ~isempty( criba ) )
        end % while ( ~choque )

        % Actualización de variables. 
        % Primero actualizamos el cluster que impacta
        cluster = [ impactado; impactante ];

        % Calculamos el centro geometrico de dicho cluster
        geomCenter = calculateGeometricalCentre( cluster );

        % Referenciamos todas las coordenadas de los centros de las particulas con respecto a dicho
        % centro geometrico
        cluster = posicionarCluster( cluster, geomCenter );

        % Lo guardamos en la estructura
        clusters{ impactado( 1, 1 ) } = cluster;

        % Actualizamos los centros de gravedad, radio máximo y radio de giro para este cluster, el
        % centro geometrico sigue siendo el [ 0 0 0 ] para cada cluster
        referencias{ impactado( 1, 1 ) }{ 2 }( 2, 1 : 3 ) = calculateCentreOfGravity( cluster );
        referencias{ impactado( 1, 1 ) }{ 2 }( 1, 4 ) = determineMaximumDiameter( clusters, impactado( 1, 1 ), referencias );
        referencias{ impactado( 1, 1 ) }{ 2 }( 2, 4 ) = calculateRadiusOfGyration( clusters, impactado( 1, 1 ), referencias );

        %% Ahora deberemos actualizar las matrices de los clústeres
        %  Eliminamos el impactante del conjunto inicial y de la estructura de datos que almacena
        %  los centros de gravedad y los radios de giro
        clusters( impactante( 1, 1 ), : ) = [];
        % Al igual que para los clústeres, eliminamos los datos del clúster impactante 
        referencias( impactante( 1, 1 ), : ) = []; 

        % Actualizamos los números de secuencia de los clústeres dentro de la estructura de datos y de
        % cada monómero dentro de su clúster y para los cdg
        for kk = 1 : size( clusters, 1 )
            clusters{ kk }( :, 1 ) = kk;
            referencias{ kk }{ 1 } = kk;
            for ll = 1 : size( clusters{ kk }, 1 )
                clusters{ kk }( ll, 2 ) = ll;
            end
        end

        % Actualizamos el contador para pasar al siguiente par de monómeros que chocan
        s = s + 1;
    end

    % Ponemos en matriz los clusters
    clusters = cell2mat( clusters );
    % Eliminamos las dos primeras columnas (numero de clúster y particula dentro del clúster)
    clusters =  clusters( :, 3 : end );
    % Extraemos la vecindad
    vec = determinarVecindad( clusters );
end